CREATE TABLE `businesses` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `businesses` (`id`, `name`, `created_at`)
SELECT
	'business_legacy',
	COALESCE(
		(SELECT `value` FROM `workspace_settings` WHERE `key` = 'business_name'),
		'Hourmark Business'
	),
	unixepoch('now') * 1000
WHERE EXISTS (SELECT 1 FROM `owners`) OR EXISTS (SELECT 1 FROM `employees`);
--> statement-breakpoint
ALTER TABLE `employees` ADD `business_id` text REFERENCES businesses(id);
--> statement-breakpoint
ALTER TABLE `owners` ADD `business_id` text REFERENCES businesses(id);
--> statement-breakpoint
UPDATE `employees`
SET `business_id` = 'business_legacy'
WHERE `business_id` IS NULL;
--> statement-breakpoint
UPDATE `owners`
SET `business_id` = 'business_legacy'
WHERE `business_id` IS NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS `employees_email_idx`;
--> statement-breakpoint
CREATE UNIQUE INDEX `employees_business_email_idx`
ON `employees` (`business_id`, `email`);
--> statement-breakpoint
CREATE INDEX `employees_business_idx` ON `employees` (`business_id`);
--> statement-breakpoint
CREATE INDEX `owners_business_idx` ON `owners` (`business_id`);
