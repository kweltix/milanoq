CREATE TABLE IF NOT EXISTS admin_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  request_key VARCHAR(100) NOT NULL,
  body_hash CHAR(64) NOT NULL,
  winner_id BIGINT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_admin_request (actor_user_id, request_key),
  CONSTRAINT fk_request_actor FOREIGN KEY (actor_user_id) REFERENCES users(id),
  CONSTRAINT fk_request_winner FOREIGN KEY (winner_id) REFERENCES winners(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
