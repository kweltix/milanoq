<?php

declare(strict_types=1);

use Milano\Security\RequestValidationException;

require_once __DIR__ . '/request-error.php';

function decode_request_object(string $raw, int $limit): array
{
    if (strlen($raw) > $limit) {
        throw new RequestValidationException('request_too_large', 413);
    }
    try {
        $object = json_decode($raw, false, 32, JSON_THROW_ON_ERROR);
    } catch (JsonException $error) {
        throw new RequestValidationException('invalid_json', 400);
    }
    if (!$object instanceof stdClass) {
        throw new RequestValidationException('json_object_required', 400);
    }
    $booleans = ['consent','age_confirmed','on','home','excluded','eligible','test','demo','confirmed','return_to_pool'];
    $numbers = ['year','quarter','quantity','version','display_order','matched_quantity','prize_slot','prize_id','ordinal','ticket_count','ts'];
    $nested = ['filters','values','products','posts','partners','prizes','st','st_en','image_ids','settings'];
    $validate = function (stdClass $node) use (&$validate, $booleans, $numbers, $nested): void {
        foreach (get_object_vars($node) as $key => $value) {
            if (in_array($key, $nested, true)) {
                if (!$value instanceof stdClass && !is_array($value)) {
                    throw new RequestValidationException('invalid_field_type', 422);
                }
                if (in_array($key, ['filters','values','settings'], true) && !$value instanceof stdClass) {
                    throw new RequestValidationException('invalid_field_type', 422);
                }
                if (in_array($key, ['products','posts','partners','prizes','st','st_en','image_ids'], true) && !is_array($value)) {
                    throw new RequestValidationException('invalid_field_type', 422);
                }
                if ($value instanceof stdClass) {
                    $validate($value);
                } else {
                    foreach ($value as $entry) {
                        if (in_array($key, ['st','st_en'], true)) {
                            if (!is_array($entry) || count($entry) !== 2 || !is_string($entry[0]) || !is_string($entry[1])) {
                                throw new RequestValidationException('invalid_field_type', 422);
                            }
                        } elseif ($key === 'image_ids') {
                            if (!is_string($entry)) {
                                throw new RequestValidationException('invalid_field_type', 422);
                            }
                        } elseif (!$entry instanceof stdClass) {
                            throw new RequestValidationException('invalid_field_type', 422);
                        } else {
                            $validate($entry);
                        }
                    }
                }
            } elseif (in_array($key, $booleans, true)) {
                if (!is_bool($value)) {
                    throw new RequestValidationException('invalid_field_type', 422);
                }
            } elseif (in_array($key, $numbers, true)) {
                if (!is_int($value) && !(is_string($value) && preg_match('/^[0-9]{1,10}$/D', $value))) {
                    throw new RequestValidationException('invalid_field_type', 422);
                }
            } elseif (!is_string($value) && !($value === null && in_array($key, ['image_id','cut_id','cover_id','legacy_key','rules_version','expected_rules_version','deleted_at'], true))) {
                throw new RequestValidationException('invalid_field_type', 422);
            }
        }
    };
    $validate($object);
    return json_decode($raw, true, 32, JSON_THROW_ON_ERROR);
}

function security_headers(bool $https): array
{
    $headers = [
        'X-Content-Type-Options' => 'nosniff', 'X-Frame-Options' => 'DENY',
        'Referrer-Policy' => 'strict-origin-when-cross-origin',
        'Permissions-Policy' => 'camera=(), microphone=(), geolocation=()',
        'Content-Security-Policy' => "default-src 'self'; script-src 'self'; script-src-attr 'none'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    ];
    // HSTS включается отдельно после проверки настоящего HTTPS-домена.
    if (getenv('MILANO_CSP_REPORT_ONLY') === '1') {
        $headers['Content-Security-Policy-Report-Only'] = $headers['Content-Security-Policy'];
        unset($headers['Content-Security-Policy']);
    }
    if ($https && getenv('MILANO_HSTS_ENABLED') === '1') {
        $headers['Strict-Transport-Security'] = 'max-age=86400';
    }
    return $headers;
}

function send_security_headers(): void
{
    foreach (security_headers(!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') as $name => $value) {
        header($name . ': ' . $value);
    }
}

function safe_request_id(): string
{
    static $id;
    return $id ??= bin2hex(random_bytes(12));
}

function log_private_error(Throwable $error): void
{
    // Не записываем message/payload/URL: исключения могут содержать SQL, токены и PII.
    try {
        $line = json_encode(['time' => gmdate('c'),'request_id' => safe_request_id(),'class' => get_class($error),'code' => (string)$error->getCode(),'source' => basename($error->getFile()),'line' => $error->getLine()]);
        $file = storage_file('logs', 'errors-' . gmdate('Y-m-d') . '.jsonl');
        $total = 0;
        foreach (glob(storage_dir('logs') . '/errors-*.jsonl') ?: [] as $existing) {
            if (is_file($existing) && !is_link($existing)) {
                $total += filesize($existing);
            }
        }
        $free = disk_free_space(storage_root());
        if ($total > 20971520 || $free === false || $free < 67108864) {
            return;
        }
        if (is_file($file) && filesize($file) > 5242880) {
            return;
        }
        file_put_contents($file, $line . "\n", FILE_APPEND | LOCK_EX);
        chmod($file, 0600);
    } catch (Throwable $ignored) {
/* При отказе диска не раскрываем исходное исключение. */
    }
}
