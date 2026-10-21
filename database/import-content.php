<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/app/bootstrap.php';
require dirname(__DIR__) . '/app/admin.php';
require dirname(__DIR__) . '/app/cms.php';
$actor = query_one("SELECT id FROM users WHERE role='admin' AND status='active' ORDER BY id LIMIT 1");
if (!$actor) throw new RuntimeException('Create an administrator before importing content');
$seed = json_decode(file_get_contents(__DIR__ . '/content-seed.json'), true, 512, JSON_THROW_ON_ERROR);
db()->beginTransaction();
try {
    foreach (['products' => 'products', 'posts' => 'articles'] as $key => $table) {
        $count = 0;
        foreach ($seed[$key] as $item) {
            if (query_one("SELECT id FROM $table WHERE legacy_key=?", [$item['legacy_key']])) continue;
            if ($table === 'products') {
                $item['image_id'] = cms_register_asset($item['image_path'])['id'];
                $item['cut_id'] = $item['cut_path'] ? cms_register_asset($item['cut_path'])['id'] : null;
            } else {
                $item['cover_id'] = $item['cover_path'] ? cms_register_asset($item['cover_path'])['id'] : null;
                $item['image_ids'] = array_map(fn($path) => cms_register_asset($path)['id'], $item['image_paths']);
            }
            cms_save($table, $item, null, (int) $actor['id']); $count++;
        }
        echo "$key imported: $count\n";
    }
    run_sql("INSERT IGNORE INTO site_settings (setting_key,value_json) VALUES ('public',?)", [json_encode(['contact_email' => '', 'contact_phone' => '', 'address_ru' => '', 'address_en' => '', 'ozon_url' => 'https://www.ozon.ru/', 'wb_url' => 'https://www.wildberries.ru/', 'market_url' => 'https://market.yandex.ru/'])]);
    db()->commit();
} catch (Throwable $e) { if (db()->inTransaction()) db()->rollBack(); throw $e; }
