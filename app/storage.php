<?php

declare(strict_types=1);

require_once __DIR__ . '/configuration.php';

function storage_validate_root(string $path, string $webroot): string
{
    $path = str_replace('\\', '/', $path);
    if (!preg_match('~^(?:[A-Za-z]:/|/)~', $path) || preg_match('~(?:^|/)\.\.(?:/|$)~', $path)) {
        throw new RuntimeException('storage_path_invalid');
    }
    $parts = explode('/', rtrim($path, '/'));
    $cursor = '';
    foreach ($parts as $part) {
        $cursor .= ($cursor === '' ? '' : '/') . $part;
        if ($cursor !== '' && is_link($cursor)) {
            throw new RuntimeException('storage_symlink_forbidden');
        }
    }
    $existing = $path;
    $suffix = '';
    while (!file_exists($existing)) {
        $suffix = '/' . basename($existing) . $suffix;
        $parent = dirname($existing);
        if ($parent === $existing) {
            throw new RuntimeException('storage_parent_missing');
        }
        $existing = $parent;
    }
    $resolved = rtrim(str_replace('\\', '/', (string)realpath($existing)), '/') . $suffix;
    $webroot = rtrim(str_replace('\\', '/', (string)realpath($webroot)), '/');
    if ($webroot === '' || strcasecmp($resolved, $webroot) === 0 || str_starts_with(strtolower($resolved) . '/', strtolower($webroot) . '/')) {
        throw new RuntimeException('storage_webroot_forbidden');
    }
    return $resolved;
}

function storage_root(): string
{
    $root = storage_validate_root(milano_config()['storage_path'], dirname(__DIR__));
    if (!is_dir($root) && !mkdir($root, 0700, true) && !is_dir($root)) {
        throw new RuntimeException('storage_unavailable');
    }
    return $root;
}

function storage_dir(string $area): string
{
    if (!in_array($area, ['receipts','media','auth','logs','sessions','locks','cache'], true)) {
        throw new RuntimeException('storage_area_invalid');
    }
    $dir = storage_root() . '/' . $area;
    if (is_link($dir)) {
        throw new RuntimeException('storage_symlink_forbidden');
    }
    if (!is_dir($dir) && !mkdir($dir, 0700) && !is_dir($dir)) {
        throw new RuntimeException('storage_unavailable');
    }
    if (strcasecmp(str_replace('\\', '/', (string)realpath($dir)), $dir) !== 0) {
        throw new RuntimeException('storage_directory_escape');
    }
    return $dir;
}

function storage_file(string $area, string $key): string
{
    if (!preg_match('/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}$/D', $key) || str_contains($key, '..')) {
        throw new RuntimeException('storage_key_invalid');
    }
    $file = storage_dir($area) . '/' . $key;
    if (is_link($file) || (file_exists($file) && !is_file($file))) {
        throw new RuntimeException('storage_file_invalid');
    }
    return $file;
}

function storage_migrate(string $source, string $target, string $webroot): array
{
    $target = storage_validate_root($target, $webroot);
    $manifest = [];
    if (!is_dir($source)) {
        return $manifest;
    }
    if (is_link($source)) {
        throw new RuntimeException('migration_symlink_forbidden');
    }
    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($source, FilesystemIterator::SKIP_DOTS));
    foreach ($iterator as $item) {
        if ($item->isLink()) {
            throw new RuntimeException('migration_symlink_forbidden');
        }
        if (!$item->isFile()) {
            continue;
        }
        $relative = substr(str_replace('\\', '/', $item->getPathname()), strlen(rtrim(str_replace('\\', '/', $source), '/')) + 1);
        if ($relative === '.htaccess') {
            continue;
        }
        if (in_array($relative, ['auth.key','demo-access.txt'], true)) {
            $relative = 'auth/' . $relative;
        }
        if (!preg_match('~^(receipts|media|auth)/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,119}$~D', $relative) || str_contains($relative, '..')) {
            throw new RuntimeException('migration_unknown_file');
        }
        $destination = $target . '/' . $relative;
        storage_validate_root(dirname($destination), $webroot);
        if (!is_dir(dirname($destination))) {
            mkdir(dirname($destination), 0700, true);
        }
        $hash = hash_file('sha256', $item->getPathname());
        if (is_link($destination) || (is_file($destination) && !hash_equals($hash, hash_file('sha256', $destination)))) {
            throw new RuntimeException('migration_destination_conflict');
        }
        if (!is_file($destination)) {
            $handle = fopen($destination, 'xb');
            $input = fopen($item->getPathname(), 'rb');
            if (!$handle || !$input || stream_copy_to_stream($input, $handle) !== $item->getSize()) {
                throw new RuntimeException('migration_copy_failed');
            }
            fclose($input);
            fclose($handle);
            chmod($destination, 0600);
        }
        if (!hash_equals($hash, hash_file('sha256', $destination)) || filesize($destination) !== $item->getSize()) {
            throw new RuntimeException('migration_integrity_failed');
        }
        $manifest[] = ['key' => $relative,'bytes' => $item->getSize(),'sha256' => $hash];
    }
    return $manifest;
}
