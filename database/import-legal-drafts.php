<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__) . '/app/bootstrap.php';
foreach (json_decode(file_get_contents(__DIR__ . '/legal-drafts.json'), true, 512, JSON_THROW_ON_ERROR) as $doc) {
    run_sql('INSERT IGNORE INTO legal_documents (document_key,version,title,body) VALUES (?,?,?,?)', [$doc['document_key'], $doc['version'], $doc['title'], $doc['body']]);
}
echo "Legal drafts imported without replacing existing versions\n";
