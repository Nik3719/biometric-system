import test from 'node:test';
import assert from 'node:assert';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

test('Тестирование подсистемы безопасности биометрической СУБД', async (t) => {

    await t.test('1. Проверка хэширования паролей операторов (BcryptJS)', async () => {
        const password = 'my_secure_password_2026';
        
        // Gенерируем хэш
        const hash = await bcrypt.hash(password, 10);
        
        assert.ok(hash, 'Хэш-строка должна быть успешно сгенерирована');
        // Исправлено: используем нодовый метод %notStrictEqual% вместо несуществующего %notEquals%
        assert.notStrictEqual(hash, password, 'Хэш не должен совпадать с исходным сырым паролем');
        
        // Проверяем валидацию хэша
        const isMatch = await bcrypt.compare(password, hash);
        assert.strictEqual(isMatch, true, 'Библиотека bcrypt должна подтверждать валидность хэша');
        
        const isWrongMatch = await bcrypt.compare('wrong_password', hash);
        assert.strictEqual(isWrongMatch, false, 'Неверный пароль не должен проходить проверку хэша');
    });

    await t.test('2. Проверка генерации и валидации сессионных JWT-токенов', () => {
        const payload = { id: 'test-uuid-12345', username: 'operator_nik', role: 'operator' };
        const secret = 'ci_test_secret_key';
        
        // Создаем токен
        const token = jwt.sign(payload, secret, { expiresIn: '1h' });
        assert.ok(token, 'JWT-токен должен успешно создаваться');
        
        // Декодируем и проверяем содержимое токена
        const decoded = jwt.verify(token, secret);
        assert.strictEqual(decoded.username, payload.username, 'Данные внутри JWT должны строго совпадать с исходным payload');
        assert.strictEqual(decoded.role, payload.role, 'Роль пользователя должна корректно считываться из токена');
        
        // Проверяем реакцию на неверный ключ подписи
        assert.throws(() => {
            jwt.verify(token, 'wrong_secret_key');
        }, /invalid signature/, 'При передаче неверного секретного ключа должна выбрасываться ошибка подписи');
    });
    
});