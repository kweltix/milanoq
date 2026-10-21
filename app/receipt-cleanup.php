<?php
declare(strict_types=1);

// Durable queue bridges the database transaction and filesystem deletion.
function cleanup_campaign_receipts(?string $campaign = null, int $limit = 500): int
{
    $limit=max(1,min(10000,$limit));
    $rows=admin_rows('SELECT storage_key FROM receipt_cleanup_queue'.($campaign?' WHERE campaign_public_id=?':'')." LIMIT $limit",$campaign?[$campaign]:[]);
    $root=realpath(storage_dir('receipts'));
    foreach($rows as $row){
        $key=$row['storage_key'];
        if(!preg_match('/^[a-f0-9]{32}\.(jpg|png|webp|pdf)$/',$key))continue;
        // Never remove a file still referenced by another receipt.
        if(query_one('SELECT id FROM receipts WHERE storage_key=?',[$key]))continue;
        if(!$root)continue;
        $candidate=$root.DIRECTORY_SEPARATOR.$key;
        if(is_link($candidate))continue;
        $file=realpath($candidate);
        if($file===false){if(!file_exists($candidate))run_sql('DELETE FROM receipt_cleanup_queue WHERE storage_key=?',[$key]);continue;}
        if(strcasecmp(dirname($file),$root)!==0 || !is_file($file))continue;
        if(@unlink($file))run_sql('DELETE FROM receipt_cleanup_queue WHERE storage_key=?',[$key]);
    }
    return (int)query_one('SELECT COUNT(*) AS n FROM receipt_cleanup_queue'.($campaign?' WHERE campaign_public_id=?':''),$campaign?[$campaign]:[])['n'];
}
