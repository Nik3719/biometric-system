import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: false,
    
    // --- НАСТРОЙКИ ОПТИМИЗАЦИИ ДЛЯ УДАЛЕННОЙ БД ---
    max: 15,                   // Максимальное количество удерживаемых соединений
    idleTimeoutMillis: 60000,  // Не закрывать свободное соединение целую минуту
    connectionTimeoutMillis: 8000, 
    keepAlive: true            // Пинговать сервер в фоне, чтобы TCP-канал не засыпал
});

// Автоматическая проверка и вставка дефолтных типов биометрии для обеспечения 3 НФ
async function initDbHelper() {
    try {
        await pool.query(`
            INSERT INTO biometric_types (id, name) 
            VALUES (1, 'face_id'), (2, 'fingerprint'), (3, 'iris')
            ON CONFLICT (id) DO NOTHING;
        `);
        console.log('Database helper: Справочник типов биометрии проверен.');
    } catch (err) {
        console.error('Ошибка инициализации справочника БД:', err.message);
    }
}
initDbHelper();

export default pool;