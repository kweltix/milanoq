ALTER TABLE campaigns MODIFY status ENUM('draft','scheduled','open','closed') NOT NULL DEFAULT 'draft', ADD workspace_version INT UNSIGNED NOT NULL DEFAULT 1;
ALTER TABLE admin_audit_log MODIFY actor_user_id BIGINT UNSIGNED DEFAULT NULL;
ALTER TABLE receipts ADD recognition_status VARCHAR(32) NOT NULL DEFAULT 'awaiting_service', ADD recognition_source VARCHAR(40) DEFAULT NULL, ADD matched_quantity INT UNSIGNED DEFAULT NULL, ADD recognized_at DATETIME DEFAULT NULL, ADD recognition_payload MEDIUMTEXT DEFAULT NULL;
