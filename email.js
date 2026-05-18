import nodemailer from 'nodemailer';

// Настройка под SMTP Gmail (Порт 587, STARTTLS)
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false, // false для порта 587, так как TLS запускается после подключения
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    },
    tls: {
        rejectUnauthorized: false // Защита от падения, если у сервера Ubuntu старые корневые сертификаты
    }
});

/**
 * Универсальная функция отправки email
 */
export async function sendEmail(to, subject, htmlContent) {
    try {
        const info = await transporter.sendMail({
            from: `"Биометрическая СУБД" <${process.env.SMTP_USER}>`,
            to: to,
            subject: subject,
            html: htmlContent
        });
        console.log(`Письмо через Gmail успешно отправлено на ${to}. ID: ${info.messageId}`);
        return true;
    } catch (error) {
        console.error('Ошибка SMTP Gmail:', error.message);
        return false;
    }
}