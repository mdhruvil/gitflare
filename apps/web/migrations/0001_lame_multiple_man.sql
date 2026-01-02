PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_issue` (
	`id` integer PRIMARY KEY NOT NULL,
	`repository_id` integer NOT NULL,
	`full_name` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`status` text DEFAULT 'open' NOT NULL,
	`creator_id` text NOT NULL,
	`creator_username` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repository`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`creator_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_issue`("id", "repository_id", "full_name", "number", "title", "body", "status", "creator_id", "creator_username", "created_at", "updated_at") SELECT "id", "repository_id", "full_name", "number", "title", "body", "status", "creator_id", "creator_username", "created_at", "updated_at" FROM `issue`;--> statement-breakpoint
DROP TABLE `issue`;--> statement-breakpoint
ALTER TABLE `__new_issue` RENAME TO `issue`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `issue_repositoryId_idx` ON `issue` (`repository_id`);--> statement-breakpoint
CREATE INDEX `issue_fullName_idx` ON `issue` (`full_name`);--> statement-breakpoint
CREATE INDEX `issue_number_idx` ON `issue` (`number`);--> statement-breakpoint
CREATE INDEX `issue_status_idx` ON `issue` (`status`);--> statement-breakpoint
CREATE TABLE `__new_pull_request` (
	`id` integer PRIMARY KEY NOT NULL,
	`repository_id` integer NOT NULL,
	`full_name` text NOT NULL,
	`number` integer NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`status` text DEFAULT 'open' NOT NULL,
	`into_branch` text NOT NULL,
	`from_branch` text NOT NULL,
	`creator_id` text NOT NULL,
	`creator_username` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`repository_id`) REFERENCES `repository`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`creator_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_pull_request`("id", "repository_id", "full_name", "number", "title", "body", "status", "into_branch", "from_branch", "creator_id", "creator_username", "created_at", "updated_at") SELECT "id", "repository_id", "full_name", "number", "title", "body", "status", "into_branch", "from_branch", "creator_id", "creator_username", "created_at", "updated_at" FROM `pull_request`;--> statement-breakpoint
DROP TABLE `pull_request`;--> statement-breakpoint
ALTER TABLE `__new_pull_request` RENAME TO `pull_request`;--> statement-breakpoint
CREATE INDEX `pullRequest_repositoryId_idx` ON `pull_request` (`repository_id`);--> statement-breakpoint
CREATE INDEX `pullRequest_fullName_idx` ON `pull_request` (`full_name`);--> statement-breakpoint
CREATE INDEX `pullRequest_status_idx` ON `pull_request` (`status`);--> statement-breakpoint
CREATE INDEX `pullRequest_number_idx` ON `pull_request` (`number`);