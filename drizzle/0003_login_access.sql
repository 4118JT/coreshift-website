ALTER TABLE `employees` ADD `access_code_hash` text;
CREATE TABLE `app_sessions` (
  `token_hash` text PRIMARY KEY NOT NULL,
  `access` text NOT NULL,
  `employee_id` integer,
  `expires_at` integer NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`)
);
CREATE INDEX `app_sessions_expires_idx` ON `app_sessions` (`expires_at`);
