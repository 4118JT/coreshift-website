ALTER TABLE `businesses` ADD `employee_join_code` text;--> statement-breakpoint
CREATE UNIQUE INDEX `businesses_employee_join_code_unique` ON `businesses` (`employee_join_code`);--> statement-breakpoint
ALTER TABLE `employees` ADD `password_hash` text;