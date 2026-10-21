<?php
declare(strict_types=1);
use Milano\Mail\DeliveryException as MilanoMailException;
require_once __DIR__ . '/mailer.php';

function local_mail_context(): bool
{
    $c = config();
    return $c['app_env'] === 'local' && in_array(parse_url($c['app_url'], PHP_URL_HOST), ['milano.local','localhost','127.0.0.1'], true);
}

function legal_drafts_allowed(): bool
{
    return test_mail_enabled() || (local_mail_context() && config()['allow_local_legal_drafts']);
}

function account_mail_enabled(): bool
{
    if (test_mail_enabled()) return true;
    if (config()['mail_transport'] !== 'smtp' || !extension_loaded('curl')) return false;
    try { milano_smtp_settings(config()); return in_array('smtps', curl_version()['protocols'], true); }
    catch (InvalidArgumentException $ignored) { return false; }
}

function test_mail_enabled(): bool
{
    $c = config();
    return $c['app_env'] === 'local' && $c['mail_transport'] === 'test' && in_array(parse_url($c['app_url'], PHP_URL_HOST), ['milano.local','localhost','127.0.0.1'], true);
}

function account_limit(string $scope, int $limit, int $seconds): void
{
    $key = hash('sha256', 'account:' . $scope);
    run_sql("INSERT INTO auth_rate_limits (bucket,attempts,expires_at) VALUES (?,1,DATE_ADD(UTC_TIMESTAMP(), INTERVAL $seconds SECOND)) ON DUPLICATE KEY UPDATE attempts=IF(expires_at<=UTC_TIMESTAMP(),1,LEAST(attempts+1,1000)),expires_at=IF(expires_at<=UTC_TIMESTAMP(),DATE_ADD(UTC_TIMESTAMP(), INTERVAL $seconds SECOND),expires_at)", [$key]);
    if ((int) query_one('SELECT attempts FROM auth_rate_limits WHERE bucket=?', [$key])['attempts'] > $limit) fail(429, 'account_rate_limited');
}

function account_secret(): string
{
    $configured = config()['auth_secret'];
    if ($configured) {
        if (strlen($configured) < 32) throw new RuntimeException('Auth secret too short');
        return $configured;
    }
    if (config()['app_env'] !== 'local') throw new RuntimeException('Production auth secret required');
    $path = storage_file('auth','auth.key');
    $handle = fopen($path, 'c+b');
    if (!$handle || !flock($handle, LOCK_EX)) throw new RuntimeException('Auth key unavailable');
    try {
        $key = stream_get_contents($handle);
        if ($key === '') { $key = bin2hex(random_bytes(32)); rewind($handle); fwrite($handle, $key); fflush($handle); chmod($path, 0600); }
        if (strlen($key) < 32) throw new RuntimeException('Invalid auth key');
        return $key;
    } finally { flock($handle, LOCK_UN); fclose($handle); }
}

function redact_mail(): void
{
    run_sql("UPDATE mail_outbox m JOIN auth_challenges c ON c.id=m.challenge_id SET m.body='' WHERE m.body<>'' AND (c.consumed_at IS NOT NULL OR c.expires_at<=UTC_TIMESTAMP())");
}

function issue_challenge(array $user, string $purpose, string $email): void
{
    if (!account_mail_enabled()) fail(503, 'mail_not_configured');
    $last = query_one('SELECT UNIX_TIMESTAMP(created_at) AS ts FROM auth_challenges WHERE user_id=? AND purpose=? ORDER BY id DESC LIMIT 1', [$user['id'], $purpose]);
    if ($last && time() - (int) $last['ts'] < 60) fail(429, 'code_cooldown');
    run_sql('UPDATE auth_challenges SET consumed_at=UTC_TIMESTAMP() WHERE user_id=? AND purpose=? AND consumed_at IS NULL', [$user['id'], $purpose]);
    $id = random_id(); $reset = $purpose === 'reset_password';
    $secret = $reset ? bin2hex(random_bytes(32)) : str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    $expires = gmdate('Y-m-d H:i:s', time() + ($reset ? 1800 : 600));
    run_sql('INSERT INTO auth_challenges (public_id,user_id,purpose,email,secret_hash,expires_at) VALUES (?,?,?,?,?,?)', [$id, $user['id'], $purpose, $email, hash_hmac('sha256', $id . ':' . $secret, account_secret()), $expires]);
    $challengeId = (int) db()->lastInsertId();
    $url = rtrim(config()['app_url'], '/') . '/#/reset?token=' . $id . '.' . $secret;
    $subject = $reset ? 'MILANO: восстановление пароля' : 'MILANO: подтверждение почты';
    $text = $reset ? "Для создания нового пароля откройте ссылку:\n$url\n\nСсылка действует 30 минут и может быть использована один раз. Если вы не запрашивали восстановление, проигнорируйте письмо." : "Код подтверждения почты MILANO: $secret\n\nВведите его на сайте. Код действует 10 минут, доступно 5 попыток. Никому не сообщайте код.";
    if (test_mail_enabled()) {
        run_sql('INSERT INTO mail_outbox (public_id,challenge_id,recipient,subject,body,expires_at) VALUES (?,?,?,?,?,?)', [random_id(), $challengeId, $email, $subject, $text, $expires]);
    } else {
        milano_smtp_send(config(), $email, $subject, $text);
    }
    redact_mail();
}

function account_password(array $input): string
{
    $password = $input['password'] ?? null;
    if (!is_string($password) || mb_strlen($password) < 10 || strlen($password) > 72 || ($input['password_confirm'] ?? '') !== $password) fail(422, 'password_validation');
    return $password;
}

function reauth(array $user, array $input): void
{
    account_limit('reauth:' . $user['id'], 15, 900);
    $row = query_one('SELECT password_hash,auth_version,status FROM users WHERE id=?', [$user['id']]);
    if (!$row || $row['status'] !== 'active' || (int) $row['auth_version'] !== (int) $user['auth_version']) fail(401, 'login_required');
    if (!is_string($input['current_password'] ?? null) || !password_verify($input['current_password'], $row['password_hash'])) fail(401, 'invalid_credentials');
    run_sql('DELETE FROM auth_rate_limits WHERE bucket=?', [hash('sha256', 'account:reauth:' . $user['id'])]);
}

function legal_current(): array
{
    $documents = admin_rows('SELECT d.id,d.document_key,d.version,d.title,d.body,d.status FROM legal_documents d JOIN (SELECT document_key,MAX(id) AS id FROM legal_documents GROUP BY document_key) latest ON latest.id=d.id ORDER BY d.document_key');
    return $documents;
}

function validate_consent(string $purpose, array $input): array
{
    if (($input['consent'] ?? false) !== true) fail(422, 'consent_required');
    $doc = query_one("SELECT * FROM legal_documents WHERE document_key='privacy' ORDER BY id DESC LIMIT 1");
    if (!$doc || ($input['document_version'] ?? '') !== $doc['version']) fail(409, 'legal_updated');
    if ($doc['status'] !== 'published' && !legal_drafts_allowed()) fail(503, 'legal_not_published');
    $documents = [$doc];
    if ($purpose === 'participation') {
        $rules = query_one("SELECT * FROM legal_documents WHERE document_key='raffle_rules' ORDER BY id DESC LIMIT 1");
        if (!$rules || ($input['rules_document_version'] ?? '') !== $rules['version']) fail(409, 'legal_updated');
        if ($rules['status'] !== 'published' && !legal_drafts_allowed()) fail(503, 'legal_not_published');
        $documents[] = $rules;
    }
    return $documents;
}

function save_consent(int $user, string $purpose, array $input, ?int $entry = null, ?array $documents = null): void
{
    foreach ($documents ?? validate_consent($purpose, $input) as $doc) run_sql('INSERT INTO user_consents (user_id,document_id,entry_id,purpose) VALUES (?,?,?,?)', [$user, $doc['id'], $entry, $purpose]);
}

function locked_account(int $id, ?int $authVersion = null): array
{
    $user = query_one('SELECT * FROM users WHERE id=? AND status=? FOR UPDATE', [$id, 'active']);
    if (!$user) fail(401, 'login_required');
    if ($authVersion !== null && (int) $user['auth_version'] !== $authVersion) fail(401, 'login_required');
    return $user;
}

function accounts_routes(string $method, string $path): void
{
    if ($method === 'GET' && $path === '/legal/current') json_out(200, ['data' => legal_current()]);
    if ($method === 'POST' && $path === '/auth/password/forgot') {
        $input = body(); $email = mb_strtolower(cms_text($input, 'email', 190));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail(422, 'validation_failed');
        account_limit('reset-ip:' . ($_SERVER['REMOTE_ADDR'] ?? ''), 20, 3600);
        account_limit('reset-email:' . $email, 5, 3600);
        if (!account_mail_enabled()) fail(503, 'mail_not_configured');
        $user = query_one("SELECT * FROM users WHERE email=? AND status='active'", [$email]);
        if ($user) {
            // Generic success also during cooldown: account existence is not disclosed.
            $last = query_one("SELECT UNIX_TIMESTAMP(created_at) AS ts FROM auth_challenges WHERE user_id=? AND purpose='reset_password' ORDER BY id DESC LIMIT 1", [$user['id']]);
            if (!$last || time() - (int) $last['ts'] >= 60) {
                try {
                    db()->beginTransaction(); $user = locked_account((int) $user['id']);
                    // Повторная проверка под блокировкой сохраняет одинаковый ответ при одновременных запросах.
                    $current = query_one("SELECT UNIX_TIMESTAMP(created_at) AS ts FROM auth_challenges WHERE user_id=? AND purpose='reset_password' ORDER BY id DESC LIMIT 1", [$user['id']]);
                    if (!$current || time() - (int)$current['ts'] >= 60) issue_challenge($user, 'reset_password', $user['email']);
                    db()->commit();
                }
                catch (MilanoMailException $error) { if (db()->inTransaction()) db()->rollBack(); log_private_error($error); }
            }
        }
        json_out(200, ['data' => ['accepted' => true]]);
    }
    if ($method === 'POST' && $path === '/auth/password/reset') {
        $input = body(); $password = account_password($input); $token = cms_text($input, 'token', 100);
        account_limit('reset-confirm:' . ($_SERVER['REMOTE_ADDR'] ?? ''), 30, 900);
        if (!preg_match('/^([a-f0-9]{32})\.([a-f0-9]{64})$/', $token, $m)) fail(401, 'invalid_reset_link');
        $row = query_one("SELECT * FROM auth_challenges WHERE public_id=? AND purpose='reset_password'", [$m[1]]);
        if (!$row) fail(401, 'invalid_reset_link');
        db()->beginTransaction(); $user = locked_account((int) $row['user_id']);
        $row = query_one('SELECT * FROM auth_challenges WHERE id=? FOR UPDATE', [$row['id']]);
        if ($row['consumed_at'] || strtotime($row['expires_at'] . ' UTC') <= time() || !hash_equals($row['secret_hash'], hash_hmac('sha256', $m[1] . ':' . $m[2], account_secret()))) fail(401, 'invalid_reset_link');
        run_sql('UPDATE users SET password_hash=?,auth_version=auth_version+1 WHERE id=?', [password_hash($password, PASSWORD_DEFAULT), $user['id']]);
        run_sql('UPDATE auth_challenges SET consumed_at=UTC_TIMESTAMP() WHERE user_id=? AND consumed_at IS NULL', [$user['id']]);
        redact_mail(); db()->commit();
        if (($_SESSION['uid'] ?? 0) == $user['id']) { $_SESSION = []; session_regenerate_id(true); $_SESSION['csrf'] = random_id(); }
        json_out(200, ['data' => ['reset' => true], 'csrf' => $_SESSION['csrf']]);
    }
    if ($path === '/me/account' && $method === 'GET') {
        $user = need_user(); json_out(200, ['data' => ['user' => public_user($user), 'entries' => status_rows((int) $user['id']), 'ticket_counts' => account_ticket_counts((int)$user['id'])]]);
    }
    if ($path === '/me/profile' && $method === 'PATCH') {
        $user = need_user(); $input = body(); $name = cms_text($input, 'name', 120); $phone = cms_text($input, 'phone', 24);
        if (mb_strlen($name) < 2 || !preg_match('/^\+?[0-9 ()-]{10,24}$/', $phone)) fail(422, 'validation_failed');
        db()->beginTransaction(); $locked = locked_account((int) $user['id'], (int) $user['auth_version']);
        if ((int) ($input['version'] ?? 0) !== (int) $locked['profile_version']) fail(409, 'profile_changed');
        run_sql('UPDATE users SET name=?,phone=?,profile_version=profile_version+1 WHERE id=?', [$name, $phone, $user['id']]); db()->commit(); json_out(200, ['data' => public_user(need_user())]);
    }
    if ($method === 'POST' && in_array($path, ['/me/email/request', '/me/email/change'], true)) {
        $user = need_user(); $input = body(); $change = $path === '/me/email/change';
        account_limit('email-request:' . $user['id'], 5, 3600);
        $email = $user['pending_email'] ?: $user['email'];
        if ($change) {
            reauth($user, $input); $email = mb_strtolower(cms_text($input, 'email', 190));
            if (!filter_var($email, FILTER_VALIDATE_EMAIL) || $email === $user['email']) fail(422, 'validation_failed');
            if (query_one('SELECT id FROM users WHERE email=?', [$email])) fail(409, 'email_taken');
        } elseif (!$user['pending_email'] && $user['email_verified_at']) fail(409, 'email_already_verified');
        db()->beginTransaction(); $locked = locked_account((int) $user['id'], (int) $user['auth_version']);
        if ($change) run_sql('UPDATE users SET pending_email=?,profile_version=profile_version+1 WHERE id=?', [$email, $user['id']]);
        issue_challenge($locked, ($change || $user['pending_email']) ? 'change_email' : 'verify_email', $email);
        db()->commit(); json_out(200, ['data' => public_user(need_user())]);
    }
    if ($method === 'POST' && $path === '/me/email/confirm') {
        $user = need_user(); $input = body(); $code = cms_text($input, 'code', 6);
        if (!preg_match('/^[0-9]{6}$/', $code)) fail(422, 'invalid_email_code');
        account_limit('email-confirm:' . $user['id'], 30, 900);
        db()->beginTransaction(); $locked = locked_account((int) $user['id'], (int) $user['auth_version']);
        $purpose = $locked['pending_email'] ? 'change_email' : 'verify_email';
        $row = query_one('SELECT * FROM auth_challenges WHERE user_id=? AND purpose=? AND consumed_at IS NULL ORDER BY id DESC LIMIT 1 FOR UPDATE', [$user['id'], $purpose]);
        if (!$row || strtotime($row['expires_at'] . ' UTC') <= time() || (int) $row['attempts'] >= 5 || $row['email'] !== ($locked['pending_email'] ?: $locked['email'])) fail(401, 'invalid_email_code');
        if (!hash_equals($row['secret_hash'], hash_hmac('sha256', $row['public_id'] . ':' . $code, account_secret()))) {
            run_sql('UPDATE auth_challenges SET attempts=attempts+1 WHERE id=?', [$row['id']]); db()->commit(); fail(401, 'invalid_email_code');
        }
        if ($purpose === 'change_email' && query_one('SELECT id FROM users WHERE email=? AND id<>?', [$row['email'], $user['id']])) fail(409, 'email_taken');
        try {
            run_sql('UPDATE users SET email=?,pending_email=NULL,email_verified_at=UTC_TIMESTAMP(),profile_version=profile_version+1,auth_version=auth_version+? WHERE id=?', [$row['email'], $purpose === 'change_email' ? 1 : 0, $user['id']]);
        } catch (PDOException $e) { if ($e->getCode() === '23000') fail(409, 'email_taken'); throw $e; }
        run_sql('UPDATE auth_challenges SET consumed_at=UTC_TIMESTAMP() WHERE user_id=? AND consumed_at IS NULL', [$user['id']]);
        redact_mail(); db()->commit(); $_SESSION['auth_version'] = (int) query_one('SELECT auth_version FROM users WHERE id=?', [$user['id']])['auth_version']; session_regenerate_id(true); $_SESSION['csrf'] = random_id();
        json_out(200, ['data' => public_user(need_user()), 'csrf' => $_SESSION['csrf']]);
    }
    if ($method === 'POST' && in_array($path, ['/me/password', '/me/sessions/revoke'], true)) {
        $user = need_user(); $input = body(); reauth($user, $input);
        $password = $path === '/me/password' ? account_password($input) : null;
        db()->beginTransaction(); locked_account((int) $user['id'], (int) $user['auth_version']);
        if ($password) run_sql('UPDATE users SET password_hash=? WHERE id=?', [password_hash($password, PASSWORD_DEFAULT), $user['id']]);
        run_sql('UPDATE users SET auth_version=auth_version+1 WHERE id=?', [$user['id']]);
        run_sql('UPDATE auth_challenges SET consumed_at=UTC_TIMESTAMP() WHERE user_id=? AND consumed_at IS NULL', [$user['id']]); redact_mail(); db()->commit();
        if ($password) $_SESSION['auth_version'] = (int) query_one('SELECT auth_version FROM users WHERE id=?', [$user['id']])['auth_version'];
        else $_SESSION = [];
        session_regenerate_id(true); $_SESSION['csrf'] = random_id();
        json_out(200, ['data' => $password ? public_user(need_user()) : null, 'csrf' => $_SESSION['csrf']]);
    }
    if (!str_starts_with($path, '/admin/accounts')) return;
    $admin = need_admin();
    if ($path === '/admin/accounts/mailbox' && $method === 'POST') {
        if (!test_mail_enabled()) fail(404, 'not_found');
        reauth($admin, body()); redact_mail();
        admin_audit((int) $admin['id'], 'account.mailbox.read', 'account', (int) $admin['id'], []);
        json_out(200, ['data' => admin_rows('SELECT public_id AS id,recipient,subject,body,expires_at,created_at FROM mail_outbox ORDER BY id DESC LIMIT 25')]);
    }
    if ($path === '/admin/accounts' && $method === 'GET') {
        $page = max(1, min(100000, (int) ($_GET['page'] ?? 1))); $offset = ($page - 1) * 25;
        $q = '%' . str_replace(['!','%','_'], ['!!','!%','!_'], mb_substr((string) ($_GET['q'] ?? ''), 0, 120)) . '%';
        json_out(200, ['data' => admin_rows("SELECT public_id AS id,name,email,phone,status,role,email_verified_at,profile_version AS version FROM users WHERE name LIKE ? ESCAPE '!' OR email LIKE ? ESCAPE '!' OR phone LIKE ? ESCAPE '!' ORDER BY id DESC LIMIT 26 OFFSET $offset", [$q, $q, $q]), 'page' => $page]);
    }
    if (preg_match('~^/admin/accounts/([a-f0-9]{32})$~', $path, $m)) {
        $row = query_one('SELECT * FROM users WHERE public_id=?', [$m[1]]); if (!$row) fail(404, 'not_found');
        if ($method === 'GET') json_out(200, ['data' => ['user' => public_user($row) + ['status' => $row['status']], 'entries' => status_rows((int) $row['id']), 'consents' => admin_rows('SELECT c.purpose,c.accepted_at,d.title,d.version,d.status FROM user_consents c JOIN legal_documents d ON d.id=c.document_id WHERE c.user_id=? ORDER BY c.id DESC LIMIT 25', [$row['id']])]]);
        if ($method === 'PATCH') {
            $input = body(); reauth($admin, $input);
            $reason = cms_text($input, 'reason', 500); if (mb_strlen($reason) < 10) fail(422, 'reason_required');
            $name = cms_text($input, 'name', 120); $email = mb_strtolower(cms_text($input, 'email', 190)); $phone = cms_text($input, 'phone', 24); $status = (string) ($input['status'] ?? '');
            if (mb_strlen($name) < 2 || !filter_var($email, FILTER_VALIDATE_EMAIL) || !preg_match('/^\+?[0-9 ()-]{10,24}$/', $phone) || !in_array($status, ['active','blocked'], true)) fail(422, 'validation_failed');
            if ($row['role'] === 'admin') fail(403, 'admin_profile_protected');
            db()->beginTransaction(); $row = query_one('SELECT * FROM users WHERE id=? FOR UPDATE', [$row['id']]);
            if ((int) ($input['version'] ?? 0) !== (int) $row['profile_version']) fail(409, 'profile_changed');
            $emailChanged = $email !== $row['email'];
            try { run_sql('UPDATE users SET name=?,email=?,phone=?,status=?,pending_email=NULL,email_verified_at=?,auth_version=auth_version+1,profile_version=profile_version+1 WHERE id=?', [$name, $email, $phone, $status, $emailChanged ? null : $row['email_verified_at'], $row['id']]); }
            catch (PDOException $e) { if ($e->getCode() === '23000') fail(409, 'email_taken'); throw $e; }
            run_sql('UPDATE auth_challenges SET consumed_at=UTC_TIMESTAMP() WHERE user_id=? AND consumed_at IS NULL', [$row['id']]); redact_mail();
            admin_audit((int) $admin['id'], 'account.admin.update', 'account', (int) $row['id'], ['reason' => $reason, 'status_from' => $row['status'], 'status_to' => $status, 'email_changed' => $emailChanged, 'fields' => ['name','email','phone']]);
            db()->commit(); json_out(200, ['data' => ['updated' => true]]);
        }
    }
    fail(404, 'not_found');
}
