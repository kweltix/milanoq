CREATE TABLE active_assignments (
  campaign_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  prize_id BIGINT UNSIGNED NOT NULL,
  prize_slot SMALLINT UNSIGNED NOT NULL,
  winner_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (campaign_id,user_id),
  UNIQUE KEY uq_active_prize_slot (prize_id,prize_slot),
  UNIQUE KEY uq_active_winner (winner_id),
  CONSTRAINT fk_assignment_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
  CONSTRAINT fk_assignment_user FOREIGN KEY (user_id) REFERENCES users(id),
  CONSTRAINT fk_assignment_prize FOREIGN KEY (prize_id) REFERENCES prizes(id),
  CONSTRAINT fk_assignment_winner FOREIGN KEY (winner_id) REFERENCES winners(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO active_assignments (campaign_id,user_id,prize_id,prize_slot,winner_id)
SELECT p.campaign_id,cp.user_id,w.prize_id,w.prize_slot,w.id FROM winners w
JOIN prizes p ON p.id=w.prize_id JOIN tickets t ON t.id=w.ticket_id
JOIN entries e ON e.id=t.entry_id JOIN campaign_participants cp ON cp.id=e.participant_id;

ALTER TABLE campaigns ADD pool_frozen_at DATETIME DEFAULT NULL;

ALTER TABLE winners DROP INDEX uq_prize_slot,
  ADD status ENUM('active','cancelled') NOT NULL DEFAULT 'active',
  ADD cancelled_at DATETIME DEFAULT NULL,
  ADD cancelled_by BIGINT UNSIGNED DEFAULT NULL,
  ADD cancellation_reason VARCHAR(500) DEFAULT NULL,
  ADD return_to_pool TINYINT(1) DEFAULT NULL,
  ADD KEY idx_winner_history (prize_id,status,id),
  ADD CONSTRAINT fk_winner_canceller FOREIGN KEY (cancelled_by) REFERENCES users(id);

CREATE TABLE draw_exclusions (
  campaign_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  excluded_at DATETIME NOT NULL,
  reason VARCHAR(80) NOT NULL,
  PRIMARY KEY (campaign_id,user_id),
  CONSTRAINT fk_drawexclusion_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
  CONSTRAINT fk_drawexclusion_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE draw_pool (
  campaign_id BIGINT UNSIGNED NOT NULL,
  ticket_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  excluded_at DATETIME DEFAULT NULL,
  exclusion_reason VARCHAR(80) DEFAULT NULL,
  PRIMARY KEY (campaign_id,ticket_id),
  KEY idx_pool_user (campaign_id,user_id),
  CONSTRAINT fk_drawpool_campaign FOREIGN KEY (campaign_id) REFERENCES campaigns(id),
  CONSTRAINT fk_drawpool_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id),
  CONSTRAINT fk_drawpool_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE draw_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  actor_user_id BIGINT UNSIGNED NOT NULL,
  request_key VARCHAR(100) NOT NULL,
  body_hash CHAR(64) NOT NULL,
  winner_id BIGINT UNSIGNED NOT NULL,
  response_json TEXT NOT NULL,
  created_at DATETIME NOT NULL,
  UNIQUE KEY uq_draw_request (actor_user_id,request_key),
  CONSTRAINT fk_drawrequest_actor FOREIGN KEY (actor_user_id) REFERENCES users(id),
  CONSTRAINT fk_drawrequest_winner FOREIGN KEY (winner_id) REFERENCES winners(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
