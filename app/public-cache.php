<?php

declare(strict_types=1);

require_once __DIR__ . '/storage.php';

function public_cache_locked(callable $operation): mixed
{
    $lock = fopen(storage_file('locks', 'public-content.lock'), 'c+');
    if (!$lock || !flock($lock, LOCK_EX)) {
        throw new RuntimeException('public_cache_lock_failed');
    }
    try {
        return $operation();
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

function public_cache_version(): string
{
    return public_cache_locked(function (): string {
        $file = storage_file('cache', 'public-version');
        if (!is_file($file)) {
            file_put_contents($file, bin2hex(random_bytes(16)), LOCK_EX);
        }
        return trim(file_get_contents($file));
    });
}

function public_cache_read(string $version): ?array
{
    return public_cache_locked(function () use ($version): ?array {
        $file = storage_file('cache', 'public-content.json');
        if (!is_file($file) || trim(file_get_contents(storage_file('cache', 'public-version'))) !== $version) {
            return null;
        }
        $entry = json_decode(file_get_contents($file), true);
        if (!is_array($entry) || ($entry['version'] ?? '') !== $version || ($entry['expires'] ?? 0) <= time()) {
            return null;
        }
        return is_array($entry['data'] ?? null) ? $entry['data'] : null;
    });
}

function public_cache_write(string $version, array $data): void
{
    public_cache_locked(function () use ($version, $data): void {
        // Медленный сборщик старой версии не может затереть свежий результат после CMS-записи.
        if (trim(file_get_contents(storage_file('cache', 'public-version'))) !== $version) {
            return;
        }
        $file = storage_file('cache', 'public-content.json');
        $temp = storage_file('cache', 'public-' . bin2hex(random_bytes(8)) . '.tmp');
        try {
            file_put_contents($temp, json_encode(['version' => $version, 'expires' => time() + 60, 'data' => $data], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE), LOCK_EX);
            if (!rename($temp, $file)) {
                throw new RuntimeException('public_cache_write_failed');
            }
        } finally {
            if (is_file($temp)) {
                unlink($temp);
            }
        }
    });
}

function public_cache_invalidate(): void
{
    public_cache_locked(function (): void {
        file_put_contents(storage_file('cache', 'public-version'), bin2hex(random_bytes(16)), LOCK_EX);
    });
}
