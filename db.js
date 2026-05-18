import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    // Если нужно подключаться к удалённой базе с SSL, установите переменную окружения PGSSLMODE
    ssl: process.env.PGSSLMODE ? { rejectUnauthorized: process.env.PGSSLMODE !== 'no-verify' } : false,
    
    // --- НАСТРОЙКИ ОПТИМИЗАЦИИ ДЛЯ УДАЛЕННОЙ БД ---
    max: 15,                   // Максимальное количество удерживаемых соединений
    idleTimeoutMillis: 300000,  // Увеличено для устойчивости (5 минут)
    connectionTimeoutMillis: 20000, // Более терпимый таймаут подключения
    keepAlive: true            // Пинговать сервер в фоне, чтобы TCP-канал не засыпал
});

// Автоматическая проверка и вставка дефолтных типов биометрии для обеспечения 3 НФ
async function initDbHelper() {
    try {
        // Попытки выполнить инициализацию с ретраями на случай временных разрывов соединения
        const sql = `
            INSERT INTO biometric_types (id, name) 
            VALUES (1, 'face_id'), (2, 'fingerprint'), (3, 'iris')
            ON CONFLICT (id) DO NOTHING;
        `;

        const maxAttempts = 4;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                await pool.query(sql);
                console.log('Database helper: Справочник типов биометрии проверен.');
                break;
            } catch (innerErr) {
                console.error(`Инициализация БД: попытка ${attempt} не удалась:`, innerErr.message || innerErr);
                if (attempt === maxAttempts) throw innerErr;
                // Экспоненциальный бэкофф
                await new Promise(r => setTimeout(r, 500 * attempt));
            }
        }
    } catch (err) {
        console.error('Ошибка инициализации справочника БД:', err.message || err);
    }
}
initDbHelper();

export default pool;