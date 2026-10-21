<?php

declare(strict_types=1);

require_once __DIR__ . '/public-cache.php';

function public_content_build(): array
{
    $products = admin_rows('SELECT * FROM products WHERE deleted_at IS NULL AND is_visible=1 ORDER BY display_order,id');
    $articles = admin_rows("SELECT * FROM articles WHERE deleted_at IS NULL AND status='published' ORDER BY published_at DESC,id DESC");
    $ids = [];
    foreach ($products as $row) {
        $ids[] = (int)$row['image_media_id'];
        $ids[] = (int)$row['cut_media_id'];
    }
    foreach ($articles as $row) {
        $ids[] = (int)$row['cover_media_id'];
    }
    $ids = array_values(array_unique(array_filter($ids)));
    $media = [];
    if ($ids) {
        foreach (admin_rows('SELECT * FROM media WHERE id IN (' . implode(',', array_fill(0, count($ids), '?')) . ')', $ids) as $row) {
            $media[(int)$row['id']] = cms_media($row);
        }
    }
    $galleries = [];
    if ($articles) {
        $articleIds = array_column($articles, 'id');
        $sql = 'SELECT m.*,ai.article_id FROM article_images ai JOIN media m ON m.id=ai.media_id WHERE ai.article_id IN (' . implode(',', array_fill(0, count($articleIds), '?')) . ') ORDER BY ai.article_id,ai.display_order';
        foreach (admin_rows($sql, $articleIds) as $row) {
            $galleries[(int)$row['article_id']][] = cms_media($row);
        }
    }
    return [
        'products' => array_map(fn ($row) => cms_product($row, $media), $products),
        'posts' => array_map(fn ($row) => cms_article($row, $media, $galleries[(int)$row['id']] ?? []), $articles),
        'settings' => cms_settings()['values'],
    ];
}

function public_content(): array
{
    $version = public_cache_version();
    $cached = public_cache_read($version);
    if ($cached !== null) {
        return $cached;
    }
    $data = public_content_build();
    public_cache_write($version, $data);
    return $data;
}
