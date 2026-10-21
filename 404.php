<?php
declare(strict_types=1);
require_once __DIR__ . '/app/http.php';
send_security_headers();
http_response_code(404);
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex');
// Отсутствующий ресурс не должен получать HTML вместо JS/CSS/изображения.
$missingPath = parse_url($_SERVER['REDIRECT_URL'] ?? $_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?: '';
if (preg_match('~\.(?:css|js|mjs|json|map|png|jpe?g|gif|webp|svg|ico|mp4|webm|woff2?|ttf|pdf)$~i', $missingPath)) {
    header('Content-Type: text/plain; charset=utf-8');
    echo "Resource not found.";
    exit;
}
header('Content-Type: text/html; charset=utf-8');
?><!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="theme-color" content="#07080a"><meta name="color-scheme" content="dark"><title>404 — MILANO</title><link rel="stylesheet" href="/not-found.css?v=20261019-4041"><script src="/not-found.js?v=20261019-4041" defer></script></head>
<body class="not-found-document"><main id="not-found-root" data-not-found-standalone><section class="not-found" data-not-found><div class="not-found-shell"><span class="not-found-brand">MILANO <small>ENERGY DRINK</small></span><p class="not-found-code" aria-hidden="true">404</p><h1>Страница не найдена</h1><p class="not-found-copy">Возможно, ссылка устарела или страница была перемещена. Вернитесь на главную — там всё самое интересное.</p><a class="not-found-home" data-not-found-home href="/#top">На главную <span aria-hidden="true">↗</span></a></div></section></main></body></html>
