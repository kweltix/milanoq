<?php

declare(strict_types=1);

function private_base(): string
{
    $project = str_replace('\\', '/', dirname(__DIR__));
    return dirname($project, 2) . '/.milano-private/' . basename($project) . '-' . substr(hash('sha256', strtolower($project)), 0, 12);
}

function milano_config(): array
{
    $production = getenv('MILANO_APP_ENV') === 'production';
    $file = private_base() . '/config.local.php';
    if (!$production && !is_file($file)) {
        $file = __DIR__ . '/config.local.php';
    }
    $local = !$production && is_file($file) ? require $file : [];
    $settings = array_merge([
        'dsn' => '', 'db_user' => '', 'db_password' => '', 'demo_receipt_auto_accept' => false,
        'app_env' => 'local', 'app_url' => 'http://milano.local', 'mail_transport' => 'test', 'auth_secret' => '',
        'storage_path' => private_base() . '/storage', 'upload_capacity' => 536870912, 'upload_free_min' => 67108864,
        'upload_user_hour' => 20, 'upload_ip_hour' => 100,
        'smtp_host' => 'smtp.mail.ru', 'smtp_port' => 465, 'smtp_username' => '', 'smtp_password' => '',
        'smtp_from' => '', 'smtp_ca_file' => '', 'allow_local_legal_drafts' => false,
    ], $local);
    // Только локальный отдельный файл вне webroot; production использует окружение.
    $mailFile = private_base() . '/mail-credentials.local.json';
    $mailOptions = private_base() . '/mail-options.local.json';
    if (!$production && getenv('MILANO_MAIL_TRANSPORT') !== 'test' && is_file($mailFile) && is_file($mailOptions)) {
        try {
            $options = json_decode(file_get_contents($mailOptions), true, 16, JSON_THROW_ON_ERROR);
            if (is_array($options) && ($options['enabled'] ?? false) === true) {
                $mail = json_decode(file_get_contents($mailFile), true, 16, JSON_THROW_ON_ERROR);
                if (!is_array($mail)) {
                    $mail = [];
                }
                $settings['mail_transport'] = 'smtp';
                $settings['smtp_username'] = $mail['email'] ?? '';
                $settings['smtp_from'] = $mail['email'] ?? '';
                $settings['smtp_password'] = $mail['app_password'] ?? '';
                $settings['allow_local_legal_drafts'] = ($options['allow_local_legal_drafts'] ?? false) === true;
            }
        } catch (JsonException $ignored) {
            // Некорректный почтовый файл не должен отключать публичные разделы сайта.
        }
    }
    foreach (
        ['dsn' => 'MILANO_DB_DSN','db_user' => 'MILANO_DB_USER','db_password' => 'MILANO_DB_PASSWORD',
        'app_env' => 'MILANO_APP_ENV','app_url' => 'MILANO_APP_URL','mail_transport' => 'MILANO_MAIL_TRANSPORT',
        'auth_secret' => 'MILANO_AUTH_SECRET','storage_path' => 'MILANO_STORAGE_PATH',
        'upload_capacity' => 'MILANO_UPLOAD_CAPACITY','upload_free_min' => 'MILANO_UPLOAD_FREE_MIN',
        'upload_user_hour' => 'MILANO_UPLOAD_USER_HOUR','upload_ip_hour' => 'MILANO_UPLOAD_IP_HOUR',
        'smtp_host' => 'MILANO_SMTP_HOST','smtp_port' => 'MILANO_SMTP_PORT',
        'smtp_username' => 'MILANO_SMTP_USERNAME','smtp_password' => 'MILANO_SMTP_PASSWORD',
        'smtp_from' => 'MILANO_SMTP_FROM','smtp_ca_file' => 'MILANO_SMTP_CA_FILE',
        'allow_local_legal_drafts' => 'MILANO_ALLOW_LOCAL_LEGAL_DRAFTS'] as $key => $env
    ) {
        if (getenv($env) !== false) {
            $settings[$key] = getenv($env);
        }
    }
    if (!in_array($settings['app_env'], ['local','production'], true)) {
        throw new RuntimeException('environment_invalid');
    }
    $settings['allow_local_legal_drafts'] = filter_var($settings['allow_local_legal_drafts'], FILTER_VALIDATE_BOOLEAN);
    if ($settings['app_env'] === 'production') {
        foreach (['MILANO_DB_DSN','MILANO_DB_USER','MILANO_DB_PASSWORD','MILANO_AUTH_SECRET','MILANO_APP_URL','MILANO_STORAGE_PATH'] as $env) {
            if (getenv($env) === false || getenv($env) === '') {
                throw new RuntimeException('production_environment_incomplete');
            }
        }
        if (strlen($settings['auth_secret']) < 32 || parse_url($settings['app_url'], PHP_URL_SCHEME) !== 'https') {
            throw new RuntimeException('production_configuration_invalid');
        }
    }
    foreach (['upload_capacity','upload_free_min','upload_user_hour','upload_ip_hour'] as $key) {
        if (filter_var($settings[$key], FILTER_VALIDATE_INT) === false || (int)$settings[$key] < 1) {
            throw new RuntimeException('quota_configuration_invalid');
        }
        $settings[$key] = (int)$settings[$key];
    }
    return $settings;
}
