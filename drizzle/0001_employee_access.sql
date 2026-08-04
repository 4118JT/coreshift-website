ALTER TABLE `employees` ADD `email` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `employees_email_idx` ON `employees` (`email`);
--> statement-breakpoint
CREATE TABLE `workspace_settings` (
  `key` text PRIMARY KEY NOT NULL,
  `value` text NOT NULL
);
