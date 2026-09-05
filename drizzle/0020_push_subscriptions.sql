CREATE TABLE `push_subscriptions` (
  `endpoint` text PRIMARY KEY NOT NULL,
  `business_id` text NOT NULL REFERENCES `businesses`(`id`) ON UPDATE no action ON DELETE no action,
  `user_type` text NOT NULL,
  `user_id` integer NOT NULL,
  `p256dh` text NOT NULL,
  `auth` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `push_subscriptions_recipient_idx` ON `push_subscriptions` (`business_id`,`user_type`,`user_id`);
