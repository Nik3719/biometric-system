import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './db.js';
import { sendEmail } from './email.js'; // Подключаем наш новый почтовый модуль

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Увеличиваем лимит размера JSON, так как биометрия передается в Base64 строках
app.use(express.json({ limit: '15mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Middleware для проверки JWT-токена (Аутентификация доступа)
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Доступ запрещен. Токен аутентификации отсутствует.' });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Недействительный или просроченный токен.' });
        }
        req.user = user;
        next();
    });
};

// Мидлварь для проверки прав доступа (Авторизация по ролям)
function requireRole(allowedRoles) {
    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            return res.status(403).json({ 
                error: 'Доступ запрещен. У вашего аккаунта недостаточно прав для выполнения этого действия.' 
            });
        }
        next();
    };
}

// --- МАРШРУТЫ АУТЕНТИФИКАЦИИ ---

// Регистрация нового пользователя
app.post('/api/auth/register', async (req, res) => {
    const { username, email, password } = req.body;
    try {
        if (!username || !email || !password) {
            return res.status(400).json({ error: 'Необходимо заполнить все поля запроса.' });
        }
        // Хеширование пароля с помощью bcryptjs
        const passwordHash = await bcrypt.hash(password, 10);
        
        const result = await pool.query(
            'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id, username, email',
            [username, email, passwordHash]
        );
        const newUser = result.rows[0];

        const welcomeHtml = `
            <div style="font-family: Arial, sans-serif; color: #0f172a; max-width: 600px; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px;">
                <h2 style="margin-bottom: 10px;">Добро пожаловать в Биометрическую Систему!</h2>
                <p>Здравствуйте, <strong>${newUser.username}</strong>!</p>
                <p>Ваш аккаунт успешно создан. Теперь вы можете добавлять субъекты, загружать биометрические записи и работать с системой.</p>
                <p style="margin-top: 20px;">Если у вас появятся вопросы, просто обратитесь к администратору системы.</p>
                <div style="margin-top: 25px; padding: 15px; background: #f8fafc; border-radius: 8px; color: #475569;">
                    <strong>Ваш логин:</strong> ${newUser.username}<br>
                    <strong>Email для входа:</strong> ${newUser.email}
                </div>
                <p style="margin-top: 20px; font-size: 12px; color: #94a3b8;">Это системное письмо. Не отвечайте на него.</p>
            </div>
        `;

        sendEmail(newUser.email, 'Добро пожаловать в Биометрическую Систему', welcomeHtml);

        res.status(201).json({ message: 'Пользователь успешно зарегистрирован', user: newUser });
    } catch (err) {
        console.error('Ошибка при регистрации пользователя:', err.message);
        res.status(400).json({ error: 'Пользователь с таким именем или email уже существует.' });
    }
});

// Авторизация (Вход)
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        const user = result.rows[0];

        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            return res.status(401).json({ error: 'Неверное имя пользователя или пароль.' });
        }

        // Генерация JWT-токена на 2 часа
        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role }, 
            process.env.JWT_SECRET, 
            { expiresIn: '2h' }
        );
        
        res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
    } catch (err) {
        console.error('Ошибка серверной авторизации:', err.message);
        res.status(500).json({ error: 'Внутренняя ошибка сервера при попытке входа.' });
    }
});

// --- API CRUD ОПЕРАЦИЙ ДЛЯ СУБЪЕКТОВ (PERSONS) С ПАГИНАЦИЕЙ И ФИЛЬТРАЦИЕЙ ---

app.get('/api/persons', authenticateToken, async (req, res) => {
    const { page = 1, limit = 5, search = '' } = req.query;
    const offset = (page - 1) * limit;
    try {
        const searchPattern = `%${search}%`;
        
        // Получаем общее количество записей для пагинации
        const countRes = await pool.query(
            'SELECT COUNT(*) FROM persons WHERE first_name ILIKE $1 OR last_name ILIKE $1 OR national_id ILIKE $1',
            [searchPattern]
        );
        const totalRecords = parseInt(countRes.rows[0].count);

        // Получаем отфильтрованные данные с лимитом страницы
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
        console.error('Ошибка получения списка субъектов:', err.message);
        res.status(500).json({ error: 'Не удалось загрузить данные реестра.' });
    }
});

// Добавление нового субъекта (National ID генерируется базой автоматически)
app.post('/api/persons', authenticateToken, async (req, res) => {
    const { first_name, last_name, phone, email } = req.body;
    try {
        // Исключили national_id из INSERT, СУБД подставит дефолтное значение из сиквенса
        const result = await pool.query(
            'INSERT INTO persons (first_name, last_name, phone, email) VALUES ($1, $2, $3, $4) RETURNING *',
            [first_name, last_name, phone, email]
        );
        
        const newPerson = result.rows[0];

        // --- АВТОМАТИЧЕСКАЯ ОТПРАВКА УВЕДОМЛЕНИЯ НА EMAIL ЧЕРЕЗ GMAIL ---
        if (newPerson.email) {
            const emailTemplate = `
                <div style="font-family: sans-serif; max-width: 600px; border: 1px solid #e2e8f0; padding: 20px; border-radius: 8px;">
                    <h2 style="color: #0f172a;">Уведомление биометрической СУБД</h2>
                    <p>Уважаемый(а) <b>${newPerson.first_name} ${newPerson.last_name}</b>,</p>
                    <p>Ваша учетная карточка была успешно зарегистрирована в Единой системе контроля доступа.</p>
                    <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 15px 0;">
                    <p style="font-size: 14px; color: #475569;">
                        Ваш автоматически сгенерированный уникальный <b>National ID:</b> 
                        <code style="background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 14px; font-weight: bold;">
                            ${newPerson.national_id}
                        </code>
                    </p>
                    <p style="font-size: 12px; color: #94a3b8; margin-top: 25px;">Это автоматическое системное уведомление. Отвечать на него не нужно.</p>
                </div>
            `;

            // Отправляем асинхронно, чтобы моментально вернуть HTTP-ответ на фронтенд
            sendEmail(newPerson.email, 'Регистрация в системе контроля доступа', emailTemplate);
        }

        res.status(201).json(newPerson);
    } catch (err) {
        console.error('Ошибка добавления субъекта:', err.message);
        res.status(400).json({ error: 'Не удалось сохранить субъекта. Проверьте уникальность контактов.' });
    }
});

app.put('/api/persons/:id', authenticateToken, async (req, res) => {
    const { first_name, last_name, phone, email } = req.body;
    try {
        if (!first_name || !last_name) {
            return res.status(400).json({ error: 'Необходимо заполнить имя и фамилию.' });
        }
        
        const result = await pool.query(
            'UPDATE persons SET first_name = $1, last_name = $2, phone = $3, email = $4 WHERE id = $5 RETURNING *',
            [first_name, last_name, phone, email, req.params.id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Субъект не найден.' });
        }
        
        res.json({ message: 'Данные субъекта успешно обновлены.', person: result.rows[0] });
    } catch (err) {
        console.error('Ошибка обновления субъекта:', err.message);
        res.status(400).json({ error: 'Не удалось обновить данные субъекта.' });
    }
});

app.delete('/api/persons/:id', authenticateToken, async (req, res) => {
    try {
        await pool.query('DELETE FROM persons WHERE id = $1', [req.params.id]);
        res.json({ message: 'Субъект и связанные биометрические записи успешно удалены.' });
    } catch (err) {
        console.error('Ошибка удаления субъекта:', err.message);
        res.status(500).json({ error: 'Не удалось удалить запись субъекта.' });
    }
});

// --- API ДЛЯ СОХРАНЕНИЯ БИОМЕТРИИ И АУДИТА ЛОГОВ ---

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

        // Фиксация действия в журнале аудита доступа (Требование безопасности лабы)
        await pool.query(
            'INSERT INTO access_logs (user_id, action, target_record_id, ip_address) VALUES ($1, $2, $3, $4)',
            [req.user.id, 'CAPTURE_BIOMETRIC_RECORD', recordResult.rows[0].id, req.ip]
        );

        res.status(201).json({ message: 'Биометрическая запись успешно добавлена и защищена хэшем.' });
    } catch (err) {
        console.error('Ошибка сохранения биометрии:', err.message);
        res.status(500).json({ error: 'Критическая ошибка сохранения биометрических данных.' });
    }
});

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
        // Фиксируем операцию удаления в журнале аудита безопасности
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

// Перенаправление всех остальных запросов на индексный файл SPA приложения
app.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Сервер запущен на порту ${PORT}`));