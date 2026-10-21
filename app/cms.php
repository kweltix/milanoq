<?php
declare(strict_types=1);
require_once __DIR__ . '/public-cache.php';

function cms_commit_public(): void
{
    db()->commit();
    public_cache_invalidate();
}

function cms_text(array $input, string $key, int $max, bool $required = true): string
{
    if (!isset($input[$key]) || !is_string($input[$key])) {
        if ($required) fail(422, 'cms_validation', [$key => 'required']);
        return '';
    }
    $value = trim($input[$key]);
    if (($required && $value === '') || mb_strlen($value) > $max) fail(422, 'cms_validation', [$key => 'invalid']);
    return $value;
}

function cms_media_id($value): ?int
{
    if ($value === null || $value === '') return null;
    if (!is_string($value) || !preg_match('/^[a-f0-9]{32}$/', $value)) fail(422, 'invalid_media');
    $media = query_one('SELECT id FROM media WHERE public_id=?', [$value]);
    if (!$media) fail(422, 'invalid_media');
    return (int) $media['id'];
}

function cms_media(array $row): array
{
    return ['id' => $row['public_id'], 'url' => $row['asset_path'] ?: '/api/v1/media/' . $row['public_id'],
        'name' => $row['original_name'], 'mime' => $row['mime'], 'width' => (int) $row['width'], 'height' => (int) $row['height']];
}

function cms_media_ref(?int $id): ?array
{
    if (!$id) return null;
    $row = query_one('SELECT * FROM media WHERE id=?', [$id]);
    return $row ? cms_media($row) : null;
}

function cms_register_asset(string $path): array
{
    if (!preg_match('~^assets/[A-Za-z0-9_./-]+\.(?:jpg|jpeg|png|webp)$~i', $path) || str_contains($path, '..')) fail(422, 'invalid_media');
    $root = realpath(dirname(__DIR__) . '/assets'); $file = realpath(dirname(__DIR__) . '/' . $path);
    if (!$file || !$root || !str_starts_with(str_replace('\\', '/', $file), str_replace('\\', '/', $root) . '/')) fail(422, 'invalid_media');
    $size = @getimagesize($file); if (!$size || !in_array($size['mime'], ['image/jpeg', 'image/png', 'image/webp'], true)) fail(422, 'invalid_media');
    $existing = query_one('SELECT * FROM media WHERE asset_path=?', [$path]);
    if ($existing) return cms_media($existing);
    run_sql('INSERT INTO media (public_id,asset_path,original_name,mime,byte_size,width,height) VALUES (?,?,?,?,?,?,?)', [random_id(), $path, basename($path), $size['mime'], filesize($file), $size[0], $size[1]]);
    return cms_media(query_one('SELECT * FROM media WHERE id=?', [db()->lastInsertId()]));
}

function cms_product(array $row, ?array $media = null): array
{
    $image = $media !== null ? ($media[(int)$row['image_media_id']] ?? null) : cms_media_ref(isset($row['image_media_id']) ? (int) $row['image_media_id'] : null);
    $cut = $media !== null ? ($media[(int)$row['cut_media_id']] ?? null) : cms_media_ref(isset($row['cut_media_id']) ? (int) $row['cut_media_id'] : null);
    return ['id' => $row['legacy_key'] ?: $row['public_id'], 'cms_id' => $row['public_id'], 'name' => $row['name_ru'], 'name_en' => $row['name_en'],
        'taste' => $row['taste_ru'], 'taste_en' => $row['taste_en'], 'note' => $row['note_ru'], 'note_en' => $row['note_en'],
        'color' => $row['color'], 'st' => json_decode($row['stats_json'], true), 'st_en' => json_decode($row['stats_en_json'], true),
        'img' => $image['url'] ?? null, 'cut' => $cut['url'] ?? null, 'image_id' => $image['id'] ?? null, 'cut_id' => $cut['id'] ?? null,
        'on' => (bool) $row['is_visible'], 'display_order' => (int) $row['display_order'], 'version' => (int) $row['version'], 'deleted_at' => $row['deleted_at']];
}

function cms_article(array $row, ?array $media = null, ?array $gallery = null): array
{
    $cover = $media !== null ? ($media[(int)$row['cover_media_id']] ?? null) : cms_media_ref(isset($row['cover_media_id']) ? (int) $row['cover_media_id'] : null);
    $images = $gallery ?? array_map('cms_media', admin_rows('SELECT m.* FROM article_images ai JOIN media m ON m.id=ai.media_id WHERE ai.article_id=? ORDER BY ai.display_order', [$row['id']]));
    return ['id' => $row['legacy_key'] ?: $row['public_id'], 'cms_id' => $row['public_id'],
        'title' => $row['title_ru'], 'title_en' => $row['title_en'], 'tag' => $row['tag_ru'], 'tag_en' => $row['tag_en'],
        'excerpt' => $row['excerpt_ru'], 'excerpt_en' => $row['excerpt_en'], 'body' => $row['body_ru'], 'body_en' => $row['body_en'],
        'img' => $cover['url'] ?? null, 'cover_id' => $cover['id'] ?? null, 'imgs' => array_column($images, 'url'), 'image_ids' => array_column($images, 'id'),
        'home' => (bool) $row['show_home'], 'status' => $row['status'], 'version' => (int) $row['version'], 'deleted_at' => $row['deleted_at'],
        'ts' => strtotime(($row['published_at'] ?: $row['created_at']) . ' UTC') * 1000];
}

function cms_stats($stats, string $field): string
{
    if (!is_array($stats) || count($stats) !== 4) fail(422, 'cms_validation', [$field => 'four_metrics_required']);
    foreach ($stats as $metric) {
        if (!is_array($metric) || count($metric) !== 2 || !isset($metric[0], $metric[1]) || !is_string($metric[0]) || !is_string($metric[1]) || mb_strlen($metric[0]) > 80 || mb_strlen($metric[1]) > 180 || trim($metric[1]) === '') fail(422, 'cms_validation', [$field => 'invalid']);
    }
    return json_encode(array_values($stats), JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
}

function cms_save(string $type, array $input, ?array $before, int $actor): string
{
    $id = $before['public_id'] ?? random_id();
    if ($before && $before['deleted_at']) fail(409, 'cms_archived');
    if ($before && (int) ($input['version'] ?? 0) !== (int) $before['version']) fail(409, 'cms_version_conflict');
    if ($type === 'products') {
        $color = cms_text($input, 'color', 7);
        if (!preg_match('/^#[a-f0-9]{6}$/i', $color)) fail(422, 'cms_validation', ['color' => 'invalid']);
        $order = filter_var($input['display_order'] ?? 0, FILTER_VALIDATE_INT);
        if ($order === false || $order < 0 || $order > 65535) fail(422, 'cms_validation', ['display_order' => 'invalid']);
        $fields = ['name_ru' => cms_text($input, 'name', 180), 'name_en' => cms_text($input, 'name_en', 180),
            'taste_ru' => cms_text($input, 'taste', 180), 'taste_en' => cms_text($input, 'taste_en', 180),
            'note_ru' => cms_text($input, 'note', 500, false), 'note_en' => cms_text($input, 'note_en', 500, trim((string) ($input['note'] ?? '')) !== ''), 'color' => $color,
            'stats_json' => cms_stats($input['st'] ?? null, 'st'), 'stats_en_json' => cms_stats($input['st_en'] ?? null, 'st_en'),
            'image_media_id' => cms_media_id($input['image_id'] ?? null), 'cut_media_id' => cms_media_id($input['cut_id'] ?? null),
            'is_visible' => !empty($input['on']) ? 1 : 0, 'display_order' => $order];
        if (!$fields['image_media_id']) fail(422, 'cms_validation', ['image_id' => 'required']);
    } else {
        $status = (string) ($input['status'] ?? 'draft');
        if (!in_array($status, ['draft', 'published'], true)) fail(422, 'cms_validation');
        $fields = ['title_ru' => cms_text($input, 'title', 240), 'title_en' => cms_text($input, 'title_en', 240, $status === 'published'),
            'tag_ru' => cms_text($input, 'tag', 80, false), 'tag_en' => cms_text($input, 'tag_en', 80, $status === 'published' && trim((string) ($input['tag'] ?? '')) !== ''),
            'excerpt_ru' => cms_text($input, 'excerpt', 1000, false), 'excerpt_en' => cms_text($input, 'excerpt_en', 1000, $status === 'published' && trim((string) ($input['excerpt'] ?? '')) !== ''),
            'body_ru' => cms_text($input, 'body', 100000, $status === 'published'), 'body_en' => cms_text($input, 'body_en', 100000, $status === 'published'),
            'cover_media_id' => cms_media_id($input['cover_id'] ?? null), 'status' => $status, 'show_home' => !empty($input['home']) ? 1 : 0,
            'published_at' => $before['published_at'] ?? ($status === 'published' ? gmdate('Y-m-d H:i:s') : null)];
        $images = $input['image_ids'] ?? [];
        if (!is_array($images) || count($images) > 20) fail(422, 'invalid_media');
        $images = array_map('cms_media_id', $images);
        if (in_array(null, $images, true)) fail(422, 'invalid_media');
        if (!$before && isset($input['legacy_key'], $input['ts']) && is_numeric($input['ts']) && (float) $input['ts'] >= 946684800000 && (float) $input['ts'] <= (time() + 3600) * 1000) $fields['published_at'] = gmdate('Y-m-d H:i:s', (int) ((float) $input['ts'] / 1000));
    }
    if ($before) {
        $sql = implode(',', array_map(fn($key) => "$key=?", array_keys($fields)));
        run_sql("UPDATE $type SET $sql,version=version+1 WHERE id=?", [...array_values($fields), $before['id']]);
        $dbId = (int) $before['id'];
    } else {
        $legacy = $input['legacy_key'] ?? null;
        if ($legacy !== null && (!is_string($legacy) || !preg_match('/^[A-Za-z0-9_-]{1,80}$/', $legacy))) fail(422, 'cms_validation');
        $fields = ['public_id' => $id, 'legacy_key' => $legacy] + $fields;
        run_sql("INSERT INTO $type (" . implode(',', array_keys($fields)) . ') VALUES (' . implode(',', array_fill(0, count($fields), '?')) . ')', array_values($fields));
        $dbId = (int) db()->lastInsertId();
    }
    if ($type === 'articles') {
        run_sql('DELETE FROM article_images WHERE article_id=?', [$dbId]);
        foreach ($images as $order => $mid) run_sql('INSERT INTO article_images (article_id,media_id,display_order) VALUES (?,?,?)', [$dbId, $mid, $order]);
    }
    admin_audit($actor, 'cms.' . $type . ($before ? '.update' : '.create'), $type, $dbId, ['public_id' => $id, 'version' => $before ? (int) $before['version'] + 1 : 1]);
    return $id;
}

function cms_upload(int $actor): array
{
    $file = $_FILES['image'] ?? null;
    if (!is_array($file)) fail(422, 'image_required');
    if (count($_FILES) !== 1) fail(422, 'unexpected_uploads');
    $mime = validate_upload_file($file, false);
    if (!in_array($mime, ['image/jpeg', 'image/png', 'image/webp'], true)) fail(415, 'unsupported_image');
    $size = @getimagesize($file['tmp_name']);
    if (!$size || $size[0] < 1 || $size[1] < 1 || $size[0] > 6000 || $size[1] > 6000 || $size[0] * $size[1] > 16000000) fail(422, 'invalid_image_dimensions');
    if (!extension_loaded('gd')) fail(503, 'image_processor_unavailable');
    $source = match ($mime) { 'image/jpeg' => @imagecreatefromjpeg($file['tmp_name']), 'image/png' => @imagecreatefrompng($file['tmp_name']), default => @imagecreatefromwebp($file['tmp_name']) };
    if (!$source) fail(422, 'invalid_image');
    $scale = min(1, 2400 / max($size[0], $size[1]));
    $width = max(1, (int) round($size[0] * $scale)); $height = max(1, (int) round($size[1] * $scale));
    $target = imagecreatetruecolor($width, $height);
    imagealphablending($target, false); imagesavealpha($target, true);
    imagefill($target, 0, 0, imagecolorallocatealpha($target, 0, 0, 0, 127));
    imagecopyresampled($target, $source, 0, 0, 0, 0, $width, $height, $size[0], $size[1]);
    $id = random_id(); $key = random_id() . '.webp'; $filename = storage_file('media', $key);
    try {
        ob_start();
        $encoded = imagewebp($target, null, 88);
        $bytes = ob_get_clean();
        if (!$encoded || !$bytes) throw new RuntimeException('Image encoding failed');
        upload_quota_check($actor, strlen($bytes));
        if (file_put_contents($filename, $bytes, LOCK_EX) !== strlen($bytes)) throw new RuntimeException('Image storage failed');
        chmod($filename,0600);
        db()->beginTransaction();
        run_sql('INSERT INTO media (public_id,storage_key,original_name,mime,byte_size,width,height,uploaded_by) VALUES (?,?,?,?,?,?,?,?)', [$id, $key, mb_substr(basename((string) $file['name']), 0, 255), 'image/webp', filesize($filename), $width, $height, $actor]);
        admin_audit($actor, 'cms.media.upload', 'media', (int) db()->lastInsertId(), ['public_id' => $id, 'width' => $width, 'height' => $height]);
        db()->commit();
    } catch (Throwable $e) {
        if (db()->inTransaction()) db()->rollBack();
        if (is_file($filename)) unlink($filename);
        throw $e;
    } finally { imagedestroy($source); imagedestroy($target); }
    return cms_media(query_one('SELECT * FROM media WHERE public_id=?', [$id]));
}

function cms_settings(): array
{
    $row = query_one("SELECT * FROM site_settings WHERE setting_key='public'");
    return $row ? ['values' => json_decode($row['value_json'], true), 'version' => (int) $row['version']] : ['values' => [], 'version' => 0];
}

function cms_partner(array $input, int $user, string $key, ?string $legacy = null): array
{
    if (!preg_match('/^[A-Za-z0-9_-]{16,100}$/', $key)) fail(422, 'invalid_idempotency_key');
    $name = cms_text($input, 'name', 120); $org = cms_text($input, 'org', 180);
    $email = mb_strtolower(cms_text($input, 'email', 190)); $phone = cms_text($input, 'phone', 24);
    if (!filter_var($email, FILTER_VALIDATE_EMAIL) || !preg_match('/^\+?[0-9 ()-]{10,24}$/', $phone)) fail(422, 'cms_validation');
    if (!$legacy && ($input['consent'] ?? false) !== true) fail(422, 'consent_required');
    $hash = hash('sha256', json_encode([$name, $org, $email, $phone]));
    $existing = query_one('SELECT public_id AS id,status,body_hash FROM partner_requests WHERE user_id=? AND idempotency_key=?', [$user, $key]);
    if ($existing) {
        if (!hash_equals($existing['body_hash'], $hash)) fail(409, 'idempotency_conflict');
        unset($existing['body_hash']); return $existing;
    }
    if (!$legacy && (int) query_one('SELECT COUNT(*) AS n FROM partner_requests WHERE user_id=? AND created_at>DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 HOUR)', [$user])['n'] >= 5) fail(429, 'partner_rate_limited');
    $id = random_id();
    run_sql("INSERT INTO partner_requests (public_id,user_id,legacy_key,idempotency_key,body_hash,name,organization,email,phone,consent_accepted_at,consent_version) VALUES (?,?,?,?,?,?,?,?,?,UTC_TIMESTAMP(),?)", [$id, $user, $legacy, $key, $hash, $name, $org, $email, $phone, $legacy ? 'legacy-demo-import' : 'partner-form-v1']);
    return ['id' => $id, 'status' => 'new'];
}

function cms_routes(string $method, string $path): void
{
    if ($method === 'GET' && $path === '/content') {
        require_once __DIR__ . '/public-content.php';
        json_out(200, ['data' => public_content()]);
    }
    if ($method === 'GET' && preg_match('~^/media/([a-f0-9]{32})$~', $path, $m)) {
        $media = query_one('SELECT * FROM media WHERE public_id=?', [$m[1]]);
        if (!$media || !$media['storage_key'] || !preg_match('/^[a-f0-9]{32}\.webp$/', $media['storage_key'])) fail(404, 'not_found');
        $file = storage_file('media', $media['storage_key']);
        if (!is_file($file)) fail(404, 'not_found');
        // Images are public website content. They never share the private receipt route.
        session_write_close();
        header('Content-Type: image/webp'); header('Content-Length: ' . filesize($file));
        header('Cache-Control: public, max-age=31536000, immutable'); header('Content-Disposition: inline; filename="image.webp"');
        readfile($file); exit;
    }
    if ($method === 'POST' && $path === '/partners') {
        $user = need_user(); $input = body();
        db()->beginTransaction();
        query_one('SELECT id FROM users WHERE id=? FOR UPDATE', [$user['id']]);
        $result = cms_partner($input, (int) $user['id'], (string) ($_SERVER['HTTP_IDEMPOTENCY_KEY'] ?? ''));
        db()->commit(); json_out(201, ['data' => $result]);
    }
    if (!str_starts_with($path, '/admin/cms/')) return;
    $admin = need_admin(); $actor = (int) $admin['id'];
    if ($path === '/admin/cms/media') {
        if ($method === 'GET') json_out(200, ['data' => array_map('cms_media', admin_rows('SELECT * FROM media ORDER BY id DESC LIMIT 500'))]);
        if ($method === 'POST') json_out(201, ['data' => cms_upload($actor)]);
    }
    if ($path === '/admin/cms/asset' && $method === 'POST') {
        $input = body();
        json_out(200, ['data' => cms_register_asset(cms_text($input, 'path', 190))]);
    }
    if ($path === '/admin/cms/settings') {
        if ($method === 'GET') json_out(200, ['data' => cms_settings()]);
        if ($method === 'PATCH') {
            $input = body(); $values = [];
            foreach (['contact_email', 'contact_phone', 'address_ru', 'address_en', 'ozon_url', 'wb_url', 'market_url'] as $field) $values[$field] = cms_text($input, $field, 500, false);
            foreach (['heroLine1','heroLine2','heroDescription','campaignBadge','campaignDescription'] as $key) foreach (['ru','en'] as $locale) $values[$key.'_'.$locale] = cms_text($input, $key.'_'.$locale, $key === 'heroLine1' || $key === 'heroLine2' ? 40 : 500, false);
            if ($values['contact_email'] && !filter_var($values['contact_email'], FILTER_VALIDATE_EMAIL)) fail(422, 'cms_validation', ['contact_email' => 'invalid']);
            foreach (['ozon_url', 'wb_url', 'market_url'] as $field) if ($values[$field] && (!filter_var($values[$field], FILTER_VALIDATE_URL) || parse_url($values[$field], PHP_URL_SCHEME) !== 'https' || parse_url($values[$field], PHP_URL_USER) !== null)) fail(422, 'cms_validation', [$field => 'https_required']);
            // Multiple company numbers are stored comma-separated; each remains a valid phone.
            foreach (explode(',', $values['contact_phone']) as $phone) if ($values['contact_phone'] && !preg_match('/^\+?[0-9 ()-]{10,24}$/', trim($phone))) fail(422, 'cms_validation', ['contact_phone' => 'invalid']);
            db()->beginTransaction(); $current = query_one("SELECT * FROM site_settings WHERE setting_key='public' FOR UPDATE");
            if ($current && (int) ($input['version'] ?? 0) !== (int) $current['version']) fail(409, 'cms_version_conflict');
            run_sql("INSERT INTO site_settings (setting_key,value_json,updated_by) VALUES ('public',?,?) ON DUPLICATE KEY UPDATE value_json=VALUES(value_json),updated_by=VALUES(updated_by),version=version+1", [json_encode($values, JSON_UNESCAPED_UNICODE), $actor]);
            admin_audit($actor, 'cms.settings.update', 'settings', 1, ['keys' => array_keys($values)]); cms_commit_public(); json_out(200, ['data' => cms_settings()]);
        }
    }
    if ($path === '/admin/cms/import' && $method === 'POST') {
        $input = body();
        foreach (['products', 'posts', 'partners'] as $key) if (!isset($input[$key]) || !is_array($input[$key]) || count($input[$key]) > 200) fail(422, 'cms_validation');
        db()->beginTransaction(); $count = ['products' => 0, 'posts' => 0, 'partners' => 0];
        foreach (['products' => 'products', 'posts' => 'articles'] as $key => $table) foreach ($input[$key] as $item) {
            if (!is_array($item)) fail(422, 'cms_validation');
            $legacy = cms_text($item, 'legacy_key', 80);
            $existing = query_one("SELECT * FROM $table WHERE legacy_key=? FOR UPDATE", [$legacy]);
            // Never overwrite later CMS edits with an old browser copy.
            if ($existing && (int) $existing['version'] > 1) fail(409, 'cms_import_conflict');
            $item['version'] = $existing['version'] ?? null;
            cms_save($table, $item, $existing, $actor); $count[$key]++;
        }
        foreach ($input['partners'] as $item) {
            if (!is_array($item)) fail(422, 'cms_validation');
            $legacy = cms_text($item, 'legacy_key', 80);
            if (!preg_match('/^[A-Za-z0-9_-]{1,80}$/', $legacy)) fail(422, 'cms_validation');
            if (!query_one('SELECT id FROM partner_requests WHERE legacy_key=?', [$legacy])) { cms_partner($item, $actor, 'legacy-partner-' . hash('sha256', $legacy), $legacy); $count['partners']++; }
        }
        admin_audit($actor, 'cms.legacy.import', 'cms', 1, $count);
        cms_commit_public(); json_out(200, ['data' => $count]);
    }
    if (preg_match('~^/admin/cms/(products|articles|partners)(?:/([a-f0-9]{32}))?(?:/(restore))?$~', $path, $m)) {
        $type = $m[1]; $table = $type === 'partners' ? 'partner_requests' : $type; $id = $m[2] ?? null;
        if ($method === 'GET' && !$id) {
            $page = max(1, min(100000, (int) ($_GET['page'] ?? 1))); $offset = ($page - 1) * 25;
            $archive = ($_GET['archive'] ?? '') === '1';
            $where = $archive ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL';
            $args=[];
            if($type==='partners'){
                $q=trim((string)($_GET['q']??''));$status=(string)($_GET['status']??'');
                if($q!==''){$like='%'.str_replace(['!','%','_'],['!!','!%','!_'],mb_substr($q,0,190)).'%';$where.=" AND (name LIKE ? ESCAPE '!' OR organization LIKE ? ESCAPE '!' OR email LIKE ? ESCAPE '!' OR phone LIKE ? ESCAPE '!' OR public_id LIKE ? ESCAPE '!')";$args=[$like,$like,$like,$like,$like];}
                if($status!==''){if(!in_array($status,['new','work','done'],true))fail(422,'invalid_filters');$where.=' AND status=?';$args[]=$status;}
            }
            $rows = admin_rows("SELECT * FROM $table WHERE $where ORDER BY id DESC LIMIT 26 OFFSET $offset",$args);
            if ($type !== 'partners') $rows = array_map($type === 'products' ? 'cms_product' : 'cms_article', $rows);
            else $rows = array_map(fn($r) => ['cms_id' => $r['public_id'], 'name' => $r['name'], 'org' => $r['organization'], 'email' => $r['email'], 'phone' => $r['phone'], 'status' => $r['status'], 'version' => (int) $r['version'], 'deleted_at' => $r['deleted_at'], 'created_at' => $r['created_at']], $rows);
            json_out(200, ['data' => $rows, 'page' => $page]);
        }
        if ($method === 'POST' && !$id && $type !== 'partners') {
            $input = body(); db()->beginTransaction(); $result = cms_save($type, $input, null, $actor); cms_commit_public(); json_out(201, ['data' => ['id' => $result]]);
        }
        if ($id && in_array($method, ['PATCH', 'DELETE', 'POST'], true)) {
            $input = body(); db()->beginTransaction(); $row = query_one("SELECT * FROM $table WHERE public_id=? FOR UPDATE", [$id]);
            if (!$row) fail(404, 'not_found');
            if ((int) ($input['version'] ?? 0) !== (int) $row['version']) fail(409, 'cms_version_conflict');
            if ($method === 'DELETE' || ($method === 'POST' && isset($m[3]))) {
                $restoring = $method === 'POST';
                run_sql("UPDATE $table SET deleted_at=" . ($restoring ? 'NULL' : 'UTC_TIMESTAMP()') . ',version=version+1 WHERE id=?', [$row['id']]);
                admin_audit($actor, 'cms.' . $type . ($restoring ? '.restore' : '.archive'), $type, (int) $row['id'], ['public_id' => $id]);
            } elseif ($method === 'PATCH') {
                if ($type === 'partners') {
                    if ($row['deleted_at'] || !in_array($input['status'] ?? '', ['new', 'work', 'done'], true)) fail(422, 'cms_validation');
                    run_sql('UPDATE partner_requests SET status=?,version=version+1 WHERE id=?', [$input['status'], $row['id']]);
                    admin_audit($actor, 'cms.partners.status', 'partners', (int) $row['id'], ['from' => $row['status'], 'to' => $input['status']]);
                } else cms_save($type, $input, $row, $actor);
            } else fail(404, 'not_found');
            if ($type === 'partners') db()->commit(); else cms_commit_public(); json_out(200, ['data' => ['id' => $id]]);
        }
    }
    fail(404, 'not_found');
}
