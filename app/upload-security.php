<?php

declare(strict_types=1);

use Milano\Security\RequestValidationException;

function validate_upload_file(array $file, bool $receipt): string
{
    if (!isset($file['error'], $file['size'], $file['tmp_name'], $file['name']) || !is_int($file['error']) || !is_int($file['size']) || !is_string($file['tmp_name']) || !is_string($file['name'])) {
        throw new RequestValidationException('invalid_upload', 422);
    }
    if ($file['error'] !== UPLOAD_ERR_OK) {
        throw new RequestValidationException(in_array($file['error'], [UPLOAD_ERR_INI_SIZE,UPLOAD_ERR_FORM_SIZE], true) ? 'upload_too_large' : 'upload_required', in_array($file['error'], [UPLOAD_ERR_INI_SIZE,UPLOAD_ERR_FORM_SIZE], true) ? 413 : 422);
    }
    if ($file['size'] < 1 || $file['size'] > 8000000) {
        throw new RequestValidationException('upload_too_large', 413);
    }
    if (!is_uploaded_file($file['tmp_name']) || filesize($file['tmp_name']) !== $file['size']) {
        throw new RequestValidationException('invalid_upload', 422);
    }
    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name']);
    $allowed = ['image/jpeg','image/png','image/webp'];
    if ($receipt) {
        $allowed[] = 'application/pdf';
    }
    if (!in_array($mime, $allowed, true)) {
        throw new RequestValidationException('unsupported_upload', 415);
    }
    if ($mime === 'application/pdf') {
        $bytes = file_get_contents($file['tmp_name']);
        if (!str_starts_with($bytes, '%PDF-') || !str_contains(substr($bytes, -2048), '%%EOF') || preg_match('~/(JavaScript|JS|Launch|EmbeddedFile|OpenAction)\b~i', $bytes)) {
            throw new RequestValidationException('unsafe_pdf', 415);
        }
    } else {
        $dimensions = @getimagesize($file['tmp_name']);
        if (!$dimensions || $dimensions[0] > 6000 || $dimensions[1] > 6000 || $dimensions[0] * $dimensions[1] > 16000000) {
            throw new RequestValidationException('invalid_image_dimensions', 422);
        }
        $image = @imagecreatefromstring(file_get_contents($file['tmp_name']));
        if (!$image) {
            throw new RequestValidationException('invalid_image', 415);
        }
        imagedestroy($image);
    }
    return $mime;
}

function upload_lock()
{
    if (isset($GLOBALS['milano_upload_lock']) && is_resource($GLOBALS['milano_upload_lock'])) {
        return $GLOBALS['milano_upload_lock'];
    }
    $handle = fopen(storage_file('locks', 'uploads.lock'), 'c+b');
    if (!$handle) {
        throw new RuntimeException('upload_lock_unavailable');
    }
    $deadline = microtime(true) + 5;
    while (!flock($handle, LOCK_EX | LOCK_NB)) {
        if (microtime(true) >= $deadline) {
            fclose($handle);
            throw new RuntimeException('upload_lock_timeout');
        }
        usleep(10000);
    }
    // При выходе/исключении PHP закрывает ресурс; локальная ссылка держится до конца request.
    $GLOBALS['milano_upload_lock'] = $handle;
    return $handle;
}

function upload_quota_check(int $userId, int $incomingBytes): void
{
    upload_lock();
    $settings = config();
    $size = 0;
    foreach (['receipts','media'] as $area) {
        foreach (new DirectoryIterator(storage_dir($area)) as $file) {
            if ($file->isLink()) {
                throw new RuntimeException('storage_symlink_forbidden');
            }
            if ($file->isFile()) {
                $size += $file->getSize();
            }
        }
    }
    $free = disk_free_space(storage_root());
    if ($free === false || $free - $incomingBytes < $settings['upload_free_min'] || $size + $incomingBytes > $settings['upload_capacity']) {
        throw new RequestValidationException('storage_capacity_reached', 507);
    }
    foreach (['user:' . $userId => $settings['upload_user_hour'],'ip:' . ($_SERVER['REMOTE_ADDR'] ?? 'unknown') => $settings['upload_ip_hour']] as $scope => $limit) {
        $key = hash('sha256', 'upload:' . $scope);
        // Общая файловая блокировка сериализует чтение/изменение квот и запись файлов на этом сервере.
        $row = query_one('SELECT attempts,expires_at FROM auth_rate_limits WHERE bucket=?', [$key]);
        if ($row && strtotime($row['expires_at'] . ' UTC') > time() && (int)$row['attempts'] >= $limit) {
            header('Retry-After: ' . max(1, strtotime($row['expires_at'] . ' UTC') - time()));
            throw new RequestValidationException('upload_rate_limited', 429);
        }
    }
    foreach (['user:' . $userId,'ip:' . ($_SERVER['REMOTE_ADDR'] ?? 'unknown')] as $scope) {
        $key = hash('sha256', 'upload:' . $scope);
        run_sql('INSERT INTO auth_rate_limits (bucket,attempts,expires_at) VALUES (?,1,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR)) ON DUPLICATE KEY UPDATE attempts=IF(expires_at<=UTC_TIMESTAMP(),1,attempts+1),expires_at=IF(expires_at<=UTC_TIMESTAMP(),DATE_ADD(UTC_TIMESTAMP(),INTERVAL 1 HOUR),expires_at)', [$key]);
    }
}
