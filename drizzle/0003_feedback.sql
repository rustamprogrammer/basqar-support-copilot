CREATE TABLE `message_feedback` (
	`message_id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`corrected_text` text,
	`note` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE no action
);
