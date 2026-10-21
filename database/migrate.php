<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/app/bootstrap.php';
require dirname(__DIR__) . '/app/draw.php';
$pdo = db();
$pdo->exec('CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(80) NOT NULL PRIMARY KEY, applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
foreach (glob(__DIR__ . '/migrations/*.sql') as $file) {
    $version = basename($file, '.sql');
    if (query_one('SELECT version FROM schema_migrations WHERE version = ?', [$version])) continue;
    // MySQL DDL auto-commits. Never silently retry a partly applied new migration.
    if($version==='007_campaign_workspace'&&query_one("SHOW COLUMNS FROM campaigns LIKE 'workspace_version'"))throw new RuntimeException('007 partially applied; restore backup or inspect before retry');
    if($version==='008_campaign_draws'&&query_one("SHOW TABLES LIKE 'active_assignments'"))throw new RuntimeException('008 partially applied; restore backup or inspect before retry');
    if($version==='008_campaign_draws')draw_migration_preflight();
    $sql = file_get_contents($file);
    foreach (explode(';', $sql) as $statement) {
        if (trim($statement) !== '') $pdo->exec($statement);
    }
    run_sql('INSERT INTO schema_migrations (version) VALUES (?)', [$version]);
    echo "Applied $version\n";
}
