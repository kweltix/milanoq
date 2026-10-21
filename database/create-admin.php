<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/app/bootstrap.php';
if (count($argv) !== 2 || !filter_var($argv[1], FILTER_VALIDATE_EMAIL)) {
    fwrite(STDERR, "Usage: php database/create-admin.php existing-user@email\n");
    exit(1);
}
$email = mb_strtolower(trim($argv[1]));
$user = query_one('SELECT id FROM users WHERE email = ?', [$email]);
if (!$user) { fwrite(STDERR, "User must register first.\n"); exit(1); }
run_sql("UPDATE users SET role = 'admin' WHERE id = ?", [$user['id']]);
echo "Admin role assigned. Existing sessions should be signed out.\n";
