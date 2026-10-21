<?php
// Production: задайте MILANO_* в окружении процесса; этот файл не содержит секретов.
// Local: после migrate-storage.php конфигурация читается из private_base()/config.local.php.
return [
    'dsn' => 'mysql:host=127.0.0.1;port=3306;dbname=milano;charset=utf8mb4',
    'db_user' => 'milano',
    'db_password' => 'change-me',
    'demo_receipt_auto_accept' => false,
    'app_env' => 'production',
    'app_url' => 'https://your-domain.example',
    'mail_transport' => 'disabled',
    // Для SMTP задайте MILANO_MAIL_TRANSPORT=smtp и MILANO_SMTP_* в окружении.
    // SMTP_HOST=smtp.mail.ru, SMTP_PORT=465, SMTP_USERNAME/SMTP_PASSWORD — пароль приложения.
    // SMTP_FROM должен совпадать с разрешённым адресом отправителя; CA_FILE — при необходимости.
    // MILANO_ALLOW_LOCAL_LEGAL_DRAFTS не разрешает черновики в production.
    'auth_secret' => '', // Set MILANO_AUTH_SECRET to a random secret of at least 32 characters.
    // MILANO_STORAGE_PATH: абсолютный путь вне document root.
];
