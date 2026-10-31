CREATE TABLE `knowledge_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`entry` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `messages` ADD `owner_hash` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `service` text;--> statement-breakpoint
CREATE INDEX `messages_owner_hash_idx` ON `messages` (`owner_hash`);