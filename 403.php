<?php
declare(strict_types=1);
require_once __DIR__ . '/app/http.php';
send_security_headers();
http_response_code(403);
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex');
?><!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>403 — MILANO</title><link rel="stylesheet" href="/not-found.css"></head><body class="not-found-document"><main class="not-found"><section class="not-found-shell"><span class="not-found-brand">MILANO</span><p class="not-found-code">403</p><h1>Доступ запрещён / Access denied</h1><p class="not-found-copy">Этот ресурс недоступен для прямого просмотра.<br>This resource is not available for direct access.</p><a class="not-found-home" href="/">На главную / Homepage</a></section></main></body></html>
