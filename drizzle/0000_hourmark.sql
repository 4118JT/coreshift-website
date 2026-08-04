CREATE TABLE `employees` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `role` text NOT NULL,
  `initials` text NOT NULL,
  `color` text DEFAULT 'green' NOT NULL,
  `active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `time_entries` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `employee_id` integer NOT NULL,
  `clock_in` integer NOT NULL,
  `clock_out` integer,
  `note` text,
  FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `time_entries_employee_idx` ON `time_entries` (`employee_id`);
--> statement-breakpoint
CREATE INDEX `time_entries_clock_in_idx` ON `time_entries` (`clock_in`);
