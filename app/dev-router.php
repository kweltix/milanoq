<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli-server') { http_response_code(404); exit; }
$path = rawurldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH) ?: '/');
if (str_contains($path, '..') || str_contains($path, '\\') || preg_match('~^/(app|database|storage|tests)(/|$)|/\.~i', $path)) { http_response_code(404); return true; }
if ($path === '/' || is_file(dirname(__DIR__) . $path)) return false;
if (str_starts_with($path, '/api/v1/')) {
    require dirname(__DIR__) . '/api/v1/index.php';
    return true;
}
http_response_code(404);
require dirname(__DIR__) . '/404.php';
