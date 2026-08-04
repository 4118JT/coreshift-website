DELETE FROM `time_entries`;
--> statement-breakpoint
DELETE FROM `app_sessions`;
--> statement-breakpoint
DELETE FROM `login_attempts`;
--> statement-breakpoint
DELETE FROM `employees`;
--> statement-breakpoint
DELETE FROM `owners`;
--> statement-breakpoint
DELETE FROM `businesses`;
--> statement-breakpoint
DELETE FROM `workspace_settings`;
--> statement-breakpoint
DELETE FROM `sqlite_sequence`
WHERE `name` IN ('employees', 'owners', 'time_entries');
