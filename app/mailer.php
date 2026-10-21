<?php

declare(strict_types=1);

use Milano\Mail\DeliveryException as MilanoMailException;

require_once __DIR__ . '/mail-error.php';

function milano_mail_message(string $from, string $to, string $subject, string $text): string
{
    foreach ([$from, $to] as $email) {
        if (strlen($email) > 190 || preg_match('/[\r\n]/', $email) || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new InvalidArgumentException('mail_address_invalid');
        }
    }
    if ($subject === '' || strlen($subject) > 180 || preg_match('/[\r\n]/', $subject) || strlen($text) > 32768) {
        throw new InvalidArgumentException('mail_message_invalid');
    }
    $domain = substr(strrchr($from, '@'), 1);
    return implode("\r\n", [
        'Date: ' . gmdate('r'),
        'Message-ID: <' . bin2hex(random_bytes(16)) . '@' . $domain . '>',
        'From: MILANO <' . $from . '>',
        'To: <' . $to . '>',
        'Subject: =?UTF-8?B?' . base64_encode($subject) . '?=',
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        chunk_split(base64_encode($text), 76, "\r\n"),
    ]);
}

function milano_smtp_settings(array $settings): array
{
    $host = $settings['smtp_host'] ?? 'smtp.mail.ru';
    $port = filter_var($settings['smtp_port'] ?? 465, FILTER_VALIDATE_INT);
    $user = $settings['smtp_username'] ?? '';
    $password = $settings['smtp_password'] ?? '';
    $from = $settings['smtp_from'] ?? $user;
    $ca = $settings['smtp_ca_file'] ?? '';
    if (
        !is_string($host) || $host === '' || strlen($host) > 253 || !preg_match('/^[a-zA-Z0-9.-]+$/D', $host)
        || $port === false || $port < 1 || $port > 65535
        || !is_string($user) || $user === '' || preg_match('/[\r\n\x00]/', $user)
        || !is_string($password) || $password === '' || strlen($password) > 1024
        || !is_string($from) || !filter_var($from, FILTER_VALIDATE_EMAIL) || preg_match('/[\r\n]/', $from)
        || !is_string($ca) || ($ca !== '' && (!is_file($ca) || !is_readable($ca)))
    ) {
        throw new InvalidArgumentException('smtp_configuration_invalid');
    }
    return ['host' => $host, 'port' => $port, 'user' => $user, 'password' => $password, 'from' => $from, 'ca' => $ca];
}

function milano_smtp_send(array $settings, string $recipient, string $subject, string $text): void
{
    $smtp = milano_smtp_settings($settings);
    $message = milano_mail_message($smtp['from'], $recipient, $subject, $text);
    if (!extension_loaded('curl') || !in_array('smtps', curl_version()['protocols'], true)) {
        throw new MilanoMailException('smtp_runtime_unavailable');
    }
    $stream = fopen('php://temp/maxmemory:65536', 'w+b');
    if ($stream === false) {
        throw new MilanoMailException('smtp_buffer_unavailable');
    }
    $handle = curl_init();
    try {
        fwrite($stream, $message);
        rewind($stream);
        $options = [
            CURLOPT_URL => 'smtps://' . $smtp['host'] . ':' . $smtp['port'],
            CURLOPT_PROTOCOLS => CURLPROTO_SMTPS,
            CURLOPT_PROXY => '',
            CURLOPT_USERNAME => $smtp['user'],
            CURLOPT_PASSWORD => $smtp['password'],
            CURLOPT_MAIL_FROM => '<' . $smtp['from'] . '>',
            CURLOPT_MAIL_RCPT => ['<' . $recipient . '>'],
            CURLOPT_UPLOAD => true,
            CURLOPT_INFILE => $stream,
            CURLOPT_INFILESIZE => strlen($message),
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 4,
            CURLOPT_TIMEOUT => 10,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_SSLVERSION => CURL_SSLVERSION_TLSv1_2,
            CURLOPT_VERBOSE => false,
        ];
        if ($smtp['ca'] !== '') {
            $options[CURLOPT_CAINFO] = $smtp['ca'];
        } elseif (defined('CURLSSLOPT_NATIVE_CA')) {
            $options[CURLOPT_SSL_OPTIONS] = CURLSSLOPT_NATIVE_CA;
        }
        curl_setopt_array($handle, $options);
        $sent = curl_exec($handle);
        $error = curl_errno($handle);
        $status = (int) curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
        if ($sent === false || $status < 200 || $status >= 300) {
            // В исключении только код класса ошибки, без адресов, паролей и ответа SMTP.
            throw new MilanoMailException($error === 67 ? 'smtp_authentication_failed' : 'smtp_delivery_failed', $error);
        }
    } finally {
        curl_close($handle);
        fclose($stream);
    }
}
