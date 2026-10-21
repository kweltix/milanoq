<?php

declare(strict_types=1);

function session_activity_valid(array $user, array $state, int $now): bool
{
    $created = $state['authenticated_at'] ?? 0;
    $last = $state['last_activity_at'] ?? 0;
    $admin = $user['role'] === 'admin';
    return is_int($created) && is_int($last) && $created > 0 && $last >= $created && $last <= $now
        && (int)($state['uid'] ?? 0) === (int)$user['id']
        && (int)($state['auth_version'] ?? 0) === (int)$user['auth_version']
        && $now - $created < ($admin ? 28800 : 7776000) && $now - $last < ($admin ? 1800 : 7776000);
}

function session_mark_authenticated(array $user, int $now): void
{
    $_SESSION['uid'] = (int)$user['id'];
    $_SESSION['auth_version'] = (int)($user['auth_version'] ?? 1);
    $_SESSION['authenticated_at'] = $now;
    $_SESSION['last_activity_at'] = $now;
    $_SESSION['auth_role'] = $user['role'] ?? 'user';
}

function session_sync_cookie(): void
{
    if (session_status() !== PHP_SESSION_ACTIVE || headers_sent()) {
        return;
    }
    $params = session_get_cookie_params();
    // Фиксированный срок от входа, а не бесконечное продление при каждом запросе.
    $expires = !empty($_SESSION['uid']) && ($_SESSION['auth_role'] ?? '') === 'user'
        ? (int)($_SESSION['authenticated_at'] ?? 0) + 7776000 : 0;
    setcookie(session_name(), session_id(), [
        'expires' => $expires, 'path' => '/', 'secure' => $params['secure'],
        'httponly' => true, 'samesite' => 'Lax',
    ]);
}
