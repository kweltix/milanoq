<?php
declare(strict_types=1);
use Milano\Security\RequestValidationException;
require_once __DIR__ . '/configuration.php';
require_once __DIR__ . '/storage.php';
require_once __DIR__ . '/session.php';
require_once __DIR__ . '/http.php';
require_once __DIR__ . '/upload-security.php';

function config(): array
{
    return milano_config();
}

function db(): PDO
{
    static $connection;
    if ($connection instanceof PDO) return $connection;
    $c = config();
    if (!$c['dsn']) throw new RuntimeException('Database is not configured');
    $connection = new PDO($c['dsn'], $c['db_user'], $c['db_password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
    $connection->exec("SET time_zone = '+00:00'");
    return $connection;
}

function random_id(): string { return bin2hex(random_bytes(16)); }

function session_start_secure(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) return;
    $https = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
    if (config()['app_env'] === 'production' && !$https) throw new RuntimeException('production_https_required');
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.gc_maxlifetime', '7776000');
    session_save_path(storage_dir('sessions'));
    session_name('milano_session');
    session_set_cookie_params(['httponly' => true, 'secure' => $https, 'samesite' => 'Lax', 'path' => '/']);
    session_start();
    if (!isset($_SESSION['csrf'])) $_SESSION['csrf'] = random_id();
}

function json_out(int $status, array $body): void
{
    session_sync_cookie();
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    send_security_headers();
    header('X-Request-ID: ' . safe_request_id());
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function fail(int $status, string $code, array $fields = []): void
{
    try { if (db()->inTransaction()) db()->rollBack(); } catch (Throwable $ignored) { /* Database may be unavailable. */ }
    json_out($status, ['error' => ['code' => $code, 'fields' => $fields]]);
}

function body(): array
{
    $type = strtolower(trim(explode(';', $_SERVER['CONTENT_TYPE'] ?? '')[0]));
    if ($type !== 'application/json') throw new RequestValidationException('json_content_type_required',415);
    $path = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?: '';
    $limit = preg_match('~^/api/v1/admin/cms/(?:articles|import|legacy-import)(?:/|$)~', $path) ? 1048576 : 65536;
    $raw = file_get_contents('php://input',false,null,0,$limit+1);
    return decode_request_object($raw === false ? '' : $raw, $limit);
}

function query_one(string $sql, array $params = []): ?array
{
    $stmt = db()->prepare($sql);
    $stmt->execute($params);
    return $stmt->fetch() ?: null;
}

function run_sql(string $sql, array $params = []): int
{
    $stmt = db()->prepare($sql);
    $stmt->execute($params);
    return $stmt->rowCount();
}

function current_user(): ?array
{
    if (empty($_SESSION['uid'])) return null;
    $user = query_one('SELECT id, public_id, name, email, phone, role, age_confirmed_at, email_verified_at, pending_email, auth_version, profile_version FROM users WHERE id = ? AND status = ?', [(int) $_SESSION['uid'], 'active']);
    if (!$user || !session_activity_valid($user, $_SESSION, time())) {
        $_SESSION = ['csrf'=>random_id()];
        session_regenerate_id(true);
        return null;
    }
    $_SESSION['last_activity_at'] = time();
    $_SESSION['auth_role'] = $user['role'];
    return $user;
}

function need_user(): array
{
    $user = current_user();
    if (!$user) fail(401, 'login_required');
    return $user;
}

function need_admin(): array
{
    $user = need_user();
    if ($user['role'] !== 'admin') fail(403, 'admin_required');
    return $user;
}

function check_csrf(): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? null;
    $expected = parse_url(config()['app_url']);
    if ($origin !== null) {
        $actual = parse_url($origin);
        if (!$actual || strtolower($actual['host'] ?? '') !== strtolower($expected['host'] ?? '')
            || ($actual['scheme'] ?? '') !== ($expected['scheme'] ?? '')
            || ($actual['port'] ?? (($actual['scheme'] ?? '') === 'https' ? 443 : 80)) !== ($expected['port'] ?? (($expected['scheme'] ?? '') === 'https' ? 443 : 80))) fail(403,'origin_forbidden');
    }
    if (($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '') === 'cross-site') fail(403,'origin_forbidden');
    $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (!is_string($token) || !hash_equals($_SESSION['csrf'] ?? '', $token)) fail(403, 'csrf_failed');
}

function public_user(array $user): array
{
    return ['id' => $user['public_id'], 'name' => $user['name'], 'email' => $user['email'], 'phone' => $user['phone'], 'role' => $user['role'], 'age_confirmed' => $user['age_confirmed_at'] !== null, 'email_verified' => !empty($user['email_verified_at']), 'pending_email' => $user['pending_email'] ?? null, 'version' => (int) ($user['profile_version'] ?? 1)];
}

function login_rate_limit(string $email): void
{
    // Shared database limits cannot be bypassed by discarding session cookies.
    foreach (['email:' . $email => 12, 'ip:' . ($_SERVER['REMOTE_ADDR'] ?? 'unknown') => 60] as $identity => $limit) {
        $bucket = hash('sha256', $identity);
        run_sql('INSERT INTO auth_rate_limits (bucket,attempts,expires_at) VALUES (?,1,DATE_ADD(UTC_TIMESTAMP(), INTERVAL 15 MINUTE)) ON DUPLICATE KEY UPDATE attempts=IF(expires_at<=UTC_TIMESTAMP(),1,LEAST(attempts+1,1000)),expires_at=IF(expires_at<=UTC_TIMESTAMP(),DATE_ADD(UTC_TIMESTAMP(), INTERVAL 15 MINUTE),expires_at)', [$bucket]);
        if ((int) query_one('SELECT attempts FROM auth_rate_limits WHERE bucket=?', [$bucket])['attempts'] > $limit) {
            header('Retry-After: 900');
            fail(429, 'login_rate_limited');
        }
    }
    run_sql('DELETE FROM auth_rate_limits WHERE expires_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY) LIMIT 100');
}
