CREATE TABLE `owners` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `email` text NOT NULL,
  `password_hash` text NOT NULL,
  `active` integer DEFAULT 1 NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `owners_email_idx` ON `owners` (`email`);
--> statement-breakpoint
ALTER TABLE `app_sessions` ADD `owner_id` integer REFERENCES owners(id);
--> statement-breakpoint
INSERT INTO owners (name, email, password_hash, active, created_at)
SELECT 'Owner', login.value, password.value, 1, unixepoch('now') * 1000
FROM workspace_settings login
JOIN workspace_settings password
WHERE login.key = 'owner_login_identifier'
  AND password.key = 'owner_password_hash'
  AND NOT EXISTS (SELECT 1 FROM owners);
