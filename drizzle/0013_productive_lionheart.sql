ALTER TABLE `employees` ADD `created_at` integer;
--> statement-breakpoint
UPDATE employees
SET created_at = COALESCE(
  (SELECT MIN(clock_in) FROM time_entries WHERE employee_id = employees.id),
  unixepoch('now') * 1000
)
WHERE created_at IS NULL;
