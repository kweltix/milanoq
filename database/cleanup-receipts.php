<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli'){http_response_code(404);exit;}
require dirname(__DIR__).'/app/bootstrap.php';
require dirname(__DIR__).'/app/admin.php';
require dirname(__DIR__).'/app/receipt-cleanup.php';
echo 'Pending receipt files: '.cleanup_campaign_receipts(null,10000)."\n";
