<?php
declare(strict_types=1);
use Milano\Security\RequestValidationException;
use Milano\Mail\DeliveryException as MilanoMailException;
ini_set('display_errors','0');
ini_set('log_errors','0');
require_once dirname(__DIR__, 2) . '/app/http.php';
set_error_handler(function (int $level,string $message,string $file,int $line): bool {
    if (!(error_reporting() & $level)) return false;
    throw new ErrorException('runtime_error',0,$level,$file,$line);
});
send_security_headers();
header('X-Request-ID: '.safe_request_id());
try {
require dirname(__DIR__, 2) . '/app/raffle.php';
require dirname(__DIR__, 2) . '/app/admin.php';
require dirname(__DIR__, 2) . '/app/cms.php';
require dirname(__DIR__, 2) . '/app/accounts.php';
require dirname(__DIR__, 2) . '/app/admin-tools.php';
require dirname(__DIR__, 2) . '/app/receipt-cleanup.php';
require dirname(__DIR__, 2) . '/app/campaign-workspace.php';
require dirname(__DIR__, 2) . '/app/draw.php';
require dirname(__DIR__, 2) . '/app/campaign-export.php';
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: strict-origin-when-cross-origin');
header('Cache-Control: no-store');

$path = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH) ?: '';
$path = preg_replace('~^.*?/api/v1~', '', $path);
$path = '/' . trim($path, '/');
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$stateless = $method === 'GET' && (in_array($path, ['/content','/legal/current','/campaign/display','/campaign/current'], true) || preg_match('~^/media/[a-f0-9]{32}$~D', $path));
if (!$stateless) session_start_secure();
// Сжимаются только публичные JSON, никогда ответы с CSRF, контактами или чеками.
if ($stateless && !str_starts_with($path, '/media/') && function_exists('ob_gzhandler')) ob_start('ob_gzhandler');

    foreach ($_GET as $value) if (!is_string($value) || strlen($value)>2048) fail(422,'invalid_query');
    foreach ($_POST as $value) if (!is_string($value) || strlen($value)>65536) fail(422,'invalid_form');
    if ((int)($_SERVER['CONTENT_LENGTH'] ?? 0)>10000000) fail(413,'request_too_large');
    if (!in_array($path, ['/content','/legal/current'], true) && !str_starts_with($path, '/media/')) workspace_sync_due_throttled();
    if ($method === 'GET' && $path === '/session') {
        $user = current_user();
        json_out(200, ['data' => ['csrf' => $_SESSION['csrf'], 'user' => $user ? public_user($user) : null, 'test_mail' => test_mail_enabled(), 'local_legal_drafts' => legal_drafts_allowed()]]);
    }

    if (!in_array($method, ['GET', 'HEAD', 'OPTIONS'], true)) check_csrf();
    campaign_export_routes($method,$path);
    workspace_routes($method,$path);
    draw_routes($method,$path);
    admin_tools_routes($method, $path);
    accounts_routes($method, $path);
    cms_routes($method, $path);
    admin_routes($method, $path);

    if ($method === 'POST' && $path === '/auth/register') {
        $input = body();
        account_limit('register-ip:' . ($_SERVER['REMOTE_ADDR'] ?? ''), 20, 3600);
        $name = trim((string) ($input['name'] ?? ''));
        $email = mb_strtolower(trim((string) ($input['email'] ?? '')));
        $phone = trim((string) ($input['phone'] ?? ''));
        $password = (string) ($input['password'] ?? '');
        $fields = [];
        if (mb_strlen($name) < 2 || mb_strlen($name) > 120) $fields['name'] = 'invalid';
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 190) $fields['email'] = 'invalid';
        if (!preg_match('/^\+?[0-9 ()-]{10,24}$/', $phone)) $fields['phone'] = 'invalid';
        if (mb_strlen($password) < 10 || strlen($password) > 72) $fields['password'] = 'invalid';
        if (($input['age_confirmed'] ?? null) !== true) $fields['age_confirmed'] = 'required';
        if ($fields) fail(422, 'validation_failed', $fields);
        if (query_one('SELECT id FROM users WHERE email = ?', [$email])) fail(409, 'email_taken');
        try {
            db()->beginTransaction();
            run_sql('INSERT INTO users (public_id, name, email, phone, password_hash, age_confirmed_at) VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP())', [random_id(), $name, $email, $phone, password_hash($password, PASSWORD_DEFAULT)]);
            $userId = (int) db()->lastInsertId();
            save_consent($userId, 'registration', $input);
            issue_challenge(query_one('SELECT * FROM users WHERE id=?', [$userId]), 'verify_email', $email);
            db()->commit();
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') fail(409, 'email_taken');
            throw $e;
        }
        session_regenerate_id(true);
        session_mark_authenticated(['id'=>$userId,'auth_version'=>1], time());
        $_SESSION['csrf'] = random_id();
        json_out(201, ['data' => public_user(need_user()), 'csrf' => $_SESSION['csrf']]);
    }

    if ($method === 'POST' && $path === '/auth/login') {
        $input = body();
        $email = mb_strtolower(trim((string) ($input['email'] ?? '')));
        login_rate_limit(mb_substr($email, 0, 190));
        $user = query_one('SELECT * FROM users WHERE email = ? AND status = ?', [$email, 'active']);
        if (!$user || !password_verify((string) ($input['password'] ?? ''), $user['password_hash'])) fail(401, 'invalid_credentials');
        if (password_needs_rehash($user['password_hash'],PASSWORD_DEFAULT)) run_sql('UPDATE users SET password_hash=? WHERE id=?',[password_hash($input['password'],PASSWORD_DEFAULT),$user['id']]);
        session_regenerate_id(true);
        session_mark_authenticated($user,time());
        $_SESSION['csrf'] = random_id();
        json_out(200, ['data' => public_user($user), 'csrf' => $_SESSION['csrf']]);
    }

    if ($method === 'POST' && $path === '/auth/logout') {
        $_SESSION = [];
        session_regenerate_id(true);
        $_SESSION['csrf'] = random_id();
        json_out(200, ['data' => ['signed_out' => true], 'csrf' => $_SESSION['csrf']]);
    }

    if ($method === 'GET' && $path === '/campaign/display') {
        $now = new DateTimeImmutable('now', new DateTimeZone('Europe/Moscow'));
        $campaign = query_one("SELECT public_id AS id,title,status,starts_at,ends_at FROM campaigns WHERE year=? AND quarter=? AND status IN ('open','closed') ORDER BY id DESC LIMIT 1", [(int)$now->format('Y'),(int)ceil((int)$now->format('n') / 3)]);
        if ($campaign) {
            $prizes = db()->prepare('SELECT title,quantity FROM prizes WHERE campaign_id=(SELECT id FROM campaigns WHERE public_id=?) ORDER BY id');
            $prizes->execute([$campaign['id']]); $campaign['prizes'] = $prizes->fetchAll();
        }
        json_out(200, ['data' => $campaign]);
    }

    if ($method === 'GET' && $path === '/campaign/current') {
        $campaign = query_one("SELECT public_id AS id, title, year, quarter, status, starts_at, ends_at FROM campaigns WHERE status = 'open' AND starts_at <= UTC_TIMESTAMP() AND ends_at > UTC_TIMESTAMP() ORDER BY starts_at DESC LIMIT 1");
        json_out(200, ['data' => $campaign]);
    }

    if ($method === 'GET' && $path === '/me/entries') {
        $user = need_user();
        json_out(200, ['data' => status_rows((int) $user['id']), 'meta' => ['ticket_counts' => account_ticket_counts((int)$user['id'])]]);
    }

    if ($method === 'POST' && $path === '/admin/campaigns') {
        $admin = need_admin();
        $input = body();
        $year = filter_var($input['year'] ?? null, FILTER_VALIDATE_INT);
        $quarter = filter_var($input['quarter'] ?? null, FILTER_VALIDATE_INT);
        $title = trim((string) ($input['title'] ?? ''));
        $status = (string) ($input['status'] ?? 'draft');
        $rulesVersion = trim((string) ($input['rules_version'] ?? ''));
        $start = DateTimeImmutable::createFromFormat('!Y-m-d\TH:i:s\Z', (string) ($input['starts_at'] ?? ''), new DateTimeZone('UTC'));
        $end = DateTimeImmutable::createFromFormat('!Y-m-d\TH:i:s\Z', (string) ($input['ends_at'] ?? ''), new DateTimeZone('UTC'));
        if (!$year || $year < 2020 || $year > 2100 || !$quarter || $quarter < 1 || $quarter > 4 || mb_strlen($title) < 3 || mb_strlen($title) > 180 || mb_strlen($rulesVersion) > 80 || !in_array($status, ['draft','open'], true) || !$start || !$end || $start >= $end || $start->format('Y-m-d\TH:i:s\Z') !== ($input['starts_at'] ?? '') || $end->format('Y-m-d\TH:i:s\Z') !== ($input['ends_at'] ?? '') || ($status === 'open' && !$rulesVersion)) fail(422, 'invalid_campaign');
        $localStart = $start->setTimezone(new DateTimeZone('Europe/Moscow'));
        if ((int) $localStart->format('Y') !== $year || (int) ceil((int) $localStart->format('n') / 3) !== $quarter) fail(422, 'invalid_campaign_quarter');
        if ($status === 'open' && (time() < $start->getTimestamp() || time() >= $end->getTimestamp())) fail(422, 'campaign_not_current');
        $id = random_id();
        try {
            db()->beginTransaction();
            run_sql('INSERT INTO campaigns (public_id, year, quarter, title, status, starts_at, ends_at, rules_version, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [$id, $year, $quarter, $title, $status, $start->format('Y-m-d H:i:s'), $end->format('Y-m-d H:i:s'), $rulesVersion ?: null, $admin['id']]);
            $dbId = (int) db()->lastInsertId();
            admin_audit((int) $admin['id'], 'campaign.create', 'campaign', $dbId, ['title' => $title, 'year' => $year, 'quarter' => $quarter, 'status' => $status, 'rules_version' => $rulesVersion, 'starts_at' => $input['starts_at'], 'ends_at' => $input['ends_at']]);
            db()->commit();
        } catch (PDOException $e) {
            if (db()->inTransaction()) db()->rollBack();
            if ($e->getCode() === '23000') fail(409, 'campaign_period_exists');
            throw $e;
        }
        json_out(201, ['data' => ['id' => $id, 'status' => $status]]);
    }

    if ($method === 'POST' && preg_match('~^/campaigns/([a-f0-9]{32})/entries$~', $path, $m)) {
        $user = need_user();
        if (!$user['email_verified_at']) fail(403, 'email_verification_required');
        if ($user['age_confirmed_at'] === null) fail(403, 'age_confirmation_required');
        $campaign = query_one('SELECT * FROM campaigns WHERE public_id = ? AND status = ? AND starts_at <= UTC_TIMESTAMP() AND ends_at > UTC_TIMESTAMP()', [$m[1], 'open']);
        if (!$campaign) fail(404, 'campaign_unavailable');
        if (empty($_POST['consent']) || $_POST['consent'] !== 'yes') fail(422, 'consent_required');
        $consentDocuments = validate_consent('participation', ['consent' => true, 'document_version' => $_POST['document_version'] ?? '', 'rules_document_version' => $_POST['rules_document_version'] ?? '']);
        $key = $_SERVER['HTTP_IDEMPOTENCY_KEY'] ?? '';
        if (!is_string($key) || !preg_match('/^[A-Za-z0-9_-]{16,100}$/', $key)) fail(422, 'invalid_idempotency_key');
        upload_lock();
        $existing = query_one('SELECT e.public_id AS id, e.status, t.public_id AS ticket_id, r.sha256 FROM entries e JOIN campaign_participants p ON p.id = e.participant_id JOIN receipts r ON r.id = e.receipt_id LEFT JOIN tickets t ON t.entry_id = e.id WHERE p.user_id = ? AND e.campaign_id = ? AND e.idempotency_key = ?', [$user['id'], $campaign['id'], $key]);
        if ($existing) {
            $retryFile = $_FILES['receipt'] ?? null;
            if (!is_array($retryFile)) fail(409,'idempotency_conflict');
            validate_upload_file($retryFile,true);
            if (!hash_equals($existing['sha256'], hash_file('sha256', $retryFile['tmp_name']))) fail(409, 'idempotency_conflict');
            unset($existing['sha256']);
            json_out(200, ['data' => $existing]);
        }
        $file = $_FILES['receipt'] ?? null;
        if (!is_array($file)) fail(422, 'receipt_required');
        if (count($_FILES) !== 1) fail(422,'unexpected_uploads');
        $mime = validate_upload_file($file,true);
        $allowed = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp', 'application/pdf' => 'pdf'];
        if (!isset($allowed[$mime])) fail(415, 'unsupported_receipt');
        // Общая upload_lock уже удерживается: параллельные повторы не обходят проверку.
        $fileHash = hash_file('sha256', $file['tmp_name']);
        if (query_one('SELECT e.id FROM receipts r JOIN entries e ON e.receipt_id=r.id WHERE e.campaign_id=? AND r.sha256=? LIMIT 1', [$campaign['id'], $fileHash])) fail(409, 'duplicate_receipt');
        upload_quota_check((int)$user['id'],$file['size']);
        $storageKey = random_id() . '.' . $allowed[$mime];
        $pathOnDisk = storage_file('receipts',$storageKey);
        if (!move_uploaded_file($file['tmp_name'], $pathOnDisk)) throw new RuntimeException('Receipt storage failed');
        chmod($pathOnDisk, 0600);
        $fileHash = hash_file('sha256', $pathOnDisk);
        try {
            db()->beginTransaction();
            $lockedUser = query_one('SELECT status,email_verified_at,auth_version FROM users WHERE id=? FOR UPDATE', [$user['id']]);
            if (!$lockedUser || $lockedUser['status'] !== 'active' || !$lockedUser['email_verified_at'] || (int) $lockedUser['auth_version'] !== (int) ($_SESSION['auth_version'] ?? 1)) { db()->rollBack(); unlink($pathOnDisk); fail(403, 'email_verification_required'); }
            $locked = query_one("SELECT id FROM campaigns WHERE id=? AND status='open' AND starts_at <= UTC_TIMESTAMP() AND ends_at > UTC_TIMESTAMP() FOR UPDATE", [$campaign['id']]);
            if (!$locked) { db()->rollBack(); unlink($pathOnDisk); fail(409, 'campaign_unavailable'); }
            run_sql('INSERT INTO campaign_participants (campaign_id, user_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)', [$campaign['id'], $user['id']]);
            $participantId = (int) db()->lastInsertId();
            run_sql('INSERT INTO receipts (public_id, owner_user_id, storage_key, original_name, mime, byte_size, sha256) VALUES (?, ?, ?, ?, ?, ?, ?)', [random_id(), $user['id'], $storageKey, mb_substr(basename((string) $file['name']), 0, 255), $mime, $file['size'], $fileHash]);
            $receiptId = (int) db()->lastInsertId();
            $publicId = random_id();
            run_sql('INSERT INTO entries (public_id, campaign_id, participant_id, receipt_id, consent_accepted_at, idempotency_key) VALUES (?, ?, ?, ?, UTC_TIMESTAMP(), ?)', [$publicId, $campaign['id'], $participantId, $receiptId, $key]);
            $entryId = (int) db()->lastInsertId();
            save_consent((int) $user['id'], 'participation', [], $entryId, $consentDocuments);
            // A new upload is not fiscal verification. code-qr.ru integration
            // will issue the verified quantity; never assume one can per file.
            db()->commit();
        } catch (Throwable $e) {
            if (db()->inTransaction()) db()->rollBack();
            unlink($pathOnDisk);
            if ($e instanceof PDOException && $e->getCode() === '23000') {
                $replay = query_one('SELECT e.public_id AS id, e.status, t.public_id AS ticket_id, r.sha256 FROM entries e JOIN campaign_participants p ON p.id=e.participant_id JOIN receipts r ON r.id=e.receipt_id LEFT JOIN tickets t ON t.entry_id=e.id WHERE p.user_id=? AND e.campaign_id=? AND e.idempotency_key=?', [$user['id'], $campaign['id'], $key]);
                if ($replay && hash_equals($replay['sha256'], $fileHash)) { unset($replay['sha256']); json_out(200, ['data' => $replay]); }
                fail(409, 'duplicate_entry');
            }
            throw $e;
        }
        $entry = query_one('SELECT e.public_id AS id, e.status, t.public_id AS ticket_id FROM entries e LEFT JOIN tickets t ON t.entry_id = e.id WHERE e.id = ?', [$entryId]);
        json_out(202, ['data' => $entry]);
    }

    fail(404, 'not_found');
} catch (MilanoMailException $e) {
    log_private_error($e);
    fail(503, 'mail_delivery_failed');
} catch (RequestValidationException $e) {
    if ($e->getCode() >= 500) log_private_error($e);
    fail((int)$e->getCode(),$e->getMessage());
} catch (Throwable $e) {
    log_private_error($e);
    if (function_exists('db')) { try { if(db()->inTransaction())db()->rollBack(); } catch(Throwable $ignored) {} }
    http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode(['error'=>['code'=>'service_unavailable','request_id'=>safe_request_id()]]);
}
