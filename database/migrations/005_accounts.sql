ALTER TABLE users ADD email_verified_at DATETIME DEFAULT NULL, ADD pending_email VARCHAR(190) DEFAULT NULL, ADD auth_version INT UNSIGNED NOT NULL DEFAULT 1, ADD profile_version INT UNSIGNED NOT NULL DEFAULT 1;
CREATE TABLE auth_challenges (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 public_id CHAR(32) NOT NULL UNIQUE,
 user_id BIGINT UNSIGNED NOT NULL,
 purpose ENUM('verify_email','change_email','reset_password') NOT NULL,
 email VARCHAR(190) NOT NULL,
 secret_hash CHAR(64) NOT NULL,
 attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
 expires_at DATETIME NOT NULL,
 consumed_at DATETIME DEFAULT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 KEY idx_challenge_user (user_id,purpose,id),
 CONSTRAINT fk_challenge_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE mail_outbox (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 public_id CHAR(32) NOT NULL UNIQUE,
 challenge_id BIGINT UNSIGNED NOT NULL,
 recipient VARCHAR(190) NOT NULL,
 subject VARCHAR(180) NOT NULL,
 body TEXT NOT NULL,
 transport ENUM('test') NOT NULL DEFAULT 'test',
 expires_at DATETIME NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT fk_mail_challenge FOREIGN KEY (challenge_id) REFERENCES auth_challenges(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE legal_documents (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 document_key VARCHAR(80) NOT NULL,
 version VARCHAR(80) NOT NULL,
 title VARCHAR(180) NOT NULL,
 body TEXT NOT NULL,
 status ENUM('draft','published') NOT NULL DEFAULT 'draft',
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_legal_version (document_key,version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE user_consents (
 id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
 user_id BIGINT UNSIGNED NOT NULL,
 document_id BIGINT UNSIGNED NOT NULL,
 entry_id BIGINT UNSIGNED DEFAULT NULL,
 purpose ENUM('registration','participation') NOT NULL,
 accepted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT fk_consent_user FOREIGN KEY (user_id) REFERENCES users(id),
 CONSTRAINT fk_consent_document FOREIGN KEY (document_id) REFERENCES legal_documents(id),
 CONSTRAINT fk_consent_entry FOREIGN KEY (entry_id) REFERENCES entries(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
