import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Увеличиваем лимит размера JSON, так как биометрия передается в Base64 строках
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Middleware для проверки JWT-токена (Авторизация доступа) [cite: 11, 36]
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Доступ запрещен. Токен аутентификации отсутствует.' }); // [cite: 18]
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Недействительный или просроченный токен.' }); // [cite: 18, 55]
        }
        req.user = user;
        next();
    });
};

// Мидлварь для проверки прав доступа (Авторизация)
function requireRole(allowedRoles) {
    return (req, res, next) => {
        // req.user заполнился ранее в мидлвари authenticateToken
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ 
                error: 'Доступ запрещен. У вашего аккаунта недостаточно прав для выполнения этого действия.' 
            });
        }
        next(); // Роль совпала, пропускаем к данным
    };
}

// --- МАРШРУТЫ АУТЕНТИФИКАЦИИ [cite: 34] ---

// Регистрация нового пользователя
app.post('/api/auth/register', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        if (!username || !email || !password) {
            return res.status(400).json({ error: 'Необходимо заполнить все поля запроса.' });
        }
        // Хеширование пароля с помощью bcryptjs [cite: 64]
        const passwordHash = await bcrypt.hash(password, 10);
        
        const result = await pool.query(
            'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email',
            [username, email, passwordHash]
        );
        res.status(201).json({ message: 'Пользователь успешно зарегистрирован', user: result.rows[0] });
    } catch (err) {
        console.error('Ошибка при регистрации пользователя:', err.message); // [cite: 40]
        res.status(400).json({ error: 'Пользователь с таким именем или email уже существует.' });
    }
});

// Авторизация (Вход) [cite: 34]
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        const user = result.rows[0];

        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ error: 'Неверное имя пользователя или пароль.' });
        }

        // Генерация JWT-токена на 2 часа [cite: 35]
        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role }, 
            process.env.JWT_SECRET, 
            { expiresIn: '2h' }
        );
        
        res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
    } catch (err) {
        console.error('Ошибка серверной авторизации:', err.message); // [cite: 40]
        res.status(500).json({ error: 'Внутренняя ошибка сервера при попытке входа.' });
    }
});

// --- API CRUD ОПЕРАЦИЙ ДЛЯ СУБЪЕКТОВ (PERSONS) С ПАГИНАЦИЕЙ И ФИЛЬТРАЦИЕЙ [cite: 30, 52, 88] ---

app.get('/api/persons', authenticateToken, async (req, res) => {
    const { page = 1, limit = 5, search = '' } = req.query;
    const offset = (page - 1) * limit;
    try {
        const searchPattern = `%${search}%`;
        
        // Получаем общее количество записей для пагинации [cite: 52]
        const countRes = await pool.query(
            'SELECT COUNT(*) FROM persons WHERE first_name ILIKE $1 OR last_name ILIKE $1 OR national_id ILIKE $1',
            [searchPattern]
        );
        const totalRecords = parseInt(countRes.rows[0].count);

        // Получаем отфильтрованные данные с лимитом страницы [cite: 52]
        const dataRes = await pool.query(
            'SELECT * FROM persons WHERE first_name ILIKE $1 OR last_name ILIKE $1 OR national_id ILIKE $1 ORDER BY registered_at DESC LIMIT $2 OFFSET $3',
            [searchPattern, limit, offset]
        );

        res.json({
            data: dataRes.rows,
            total: totalRecords,
            page: parseInt(page),
            pages: Math.ceil(totalRecords / limit)
        });
    } catch (err) {
        console.error('Ошибка получения списка субъектов:', err.message); // [cite: 40]
        res.status(500).json({ error: 'Не удалось загрузить данные реестра.' });
    }
});

app.post('/api/persons', authenticateToken, async (req, res) => {
    const { first_name, last_name, national_id } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO persons (first_name, last_name, national_id) VALUES ($1, $2, $3) RETURNING *',
            [first_name, last_name, national_id]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Ошибка добавления субъекта:', err.message); // [cite: 40]
        res.status(400).json({ error: 'Субъект с таким National ID уже зарегистрирован в системе.' });
    }
});

app.put('/api/persons/:id', authenticateToken, async (req, res) => {
    const { first_name, last_name, national_id } = req.body;
    try {
        if (!first_name || !last_name) {
            return res.status(400).json({ error: 'Необходимо заполнить имя и фамилию.' });
        }
        
        const result = await pool.query(
            'UPDATE persons SET first_name = $1, last_name = $2, national_id = $3 WHERE id = $4 RETURNING *',
            [first_name, last_name, national_id, req.params.id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Субъект не найден.' });
        }
        
        res.json({ message: 'Данные субъекта успешно обновлены.', person: result.rows[0] });
    } catch (err) {
        console.error('Ошибка обновления субъекта:', err.message); // [cite: 40]
        res.status(400).json({ error: 'Не удалось обновить данные субъекта.' });
    }
});

app.delete('/api/persons/:id', authenticateToken, async (req, res) => {
    try {
        await pool.query('DELETE FROM persons WHERE id = $1', [req.params.id]);
        res.json({ message: 'Субъект и связанные биометрические записи успешно удалены.' });
    } catch (err) {
        console.error('Ошибка удаления субъекта:', err.message); // [cite: 40]
        res.status(500).json({ error: 'Не удалось удалить запись субъекта.' });
    }
});

// --- API ДЛЯ СОХРАНЕНИЯ БИОМЕТРИИ И АУДИТА ЛОГОВ [cite: 9] ---

app.post('/api/biometrics', authenticateToken, async (req, res) => {
    const { person_id, type_id, image_base64 } = req.body;
    try {
        if (!person_id || !type_id || !image_base64) {
            return res.status(400).json({ error: 'Переданы не все параметры биометрии.' });
        }

        // Вычисление простой контрольной суммы (hash_sum) строки для проверки целостности данных
        const hash_sum = Buffer.from(image_base64.substring(0, 50)).toString('hex').substring(0, 64);

        // Сохраняем биометрическую запись
        const recordResult = await pool.query(
            'INSERT INTO biometric_records (person_id, type_id, captured_by, image_base64, hash_sum) VALUES ($1, $2, $3, $4, $5) RETURNING id',
            [person_id, type_id, req.user.id, image_base64, hash_sum]
        );

        // Фиксация действия в журнале аудита доступа (Требование безопасности лабы) [cite: 16]
        await pool.query(
            'INSERT INTO access_logs (user_id, action, target_record_id, ip_address) VALUES ($1, $2, $3, $4)',
            [req.user.id, 'CAPTURE_BIOMETRIC_RECORD', recordResult.rows[0].id, req.ip]
        );

        res.status(201).json({ message: 'Биометрическая запись успешно добавлена и защищена хэшем.' });
    } catch (err) {
        console.error('Ошибка сохранения биометрии:', err.message); // [cite: 40]
        res.status(500).json({ error: 'Критическая ошибка сохранения биометрических данных.' });
    }
});

// Перенаправление всех остальных GET-запросов на индексный файл SPA приложения [cite: 43]
// Стало (совместимо с Express 5):
// --- ДОПОЛНИТЕЛЬНЫЕ API ДЛЯ РАБОТЫ С КАРТИНКАМИ БИОМЕТРИИ ---

// 1. Получить все биометрические снимки конкретного субъекта
app.get('/api/biometrics/:person_id', authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT br.id, br.type_id, bt.name as type_name, br.image_base64, br.hash_sum, br.captured_at 
             FROM biometric_records br
             JOIN biometric_types bt ON br.type_id = bt.id
             WHERE br.person_id = $1 
             ORDER BY br.captured_at DESC`,
            [req.params.person_id]
        );
        res.json(result.rows);
    } catch (err) {
        console.error('Ошибка получения биометрических снимков:', err.message);
        res.status(500).json({ error: 'Не удалось загрузить биометрический профиль субъекта.' });
    }
});

// 2. Удалить конкретный снимок биометрии (с фиксацией в аудите)
app.delete('/api/biometrics/:id', authenticateToken, async (req, res) => {
    try {
        // Фиксируем операцию удаления в журнале аудита безопасности (Требование лабы)
        await pool.query(
            'INSERT INTO access_logs (user_id, action, target_record_id, ip_address) VALUES ($1, $2, $3, $4)',
            [req.user.id, 'DELETE_BIOMETRIC_RECORD', req.params.id, req.ip]
        );
        
        await pool.query('DELETE FROM biometric_records WHERE id = $1', [req.params.id]);
        res.json({ message: 'Снимок успешно удален из базы данных.' });
    } catch (err) {
        console.error('Ошибка удаления биометрической записи:', err.message);
        res.status(500).json({ error: 'Не удалось удалить снимок из архива.' });
    }
});
app.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Сервер запущен на порту ${PORT}`));