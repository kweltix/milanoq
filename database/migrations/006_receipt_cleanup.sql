CREATE TABLE receipt_cleanup_queue (
 storage_key VARCHAR(120) NOT NULL PRIMARY KEY,
 campaign_public_id CHAR(32) NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY idx_cleanup_campaign (campaign_public_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
