<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require_once __DIR__ . '/../app/raffle.php';
require_once __DIR__ . '/../app/admin.php';
require_once __DIR__ . '/../app/campaign-workspace.php';
workspace_sync_due();
echo "Campaign maintenance completed\n";
