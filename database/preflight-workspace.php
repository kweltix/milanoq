<?php
declare(strict_types=1);
// Read-only compatibility and data-count report; never prints credentials/PII.
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
$root=realpath($argv[1]??dirname(__DIR__));
if(!$root||!is_file($root.'/app/bootstrap.php'))throw new RuntimeException('Project root required');
require $root.'/app/bootstrap.php';
require dirname(__DIR__).'/app/draw.php';
draw_migration_preflight();
$counts=[];$tables=db()->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN);
foreach(['users','campaigns','campaign_participants','receipts','entries','tickets','prizes','winners','user_consents'] as $table){
    if(in_array($table,$tables,true))$counts[$table]=(int)query_one('SELECT COUNT(*) AS n FROM `'.$table.'`')['n'];
}
$versions=db()->query('SELECT version FROM schema_migrations ORDER BY version')->fetchAll(PDO::FETCH_COLUMN);
echo json_encode(['preflight'=>'passed','counts'=>$counts,'migrations'=>$versions],JSON_UNESCAPED_SLASHES|JSON_THROW_ON_ERROR),PHP_EOL;
