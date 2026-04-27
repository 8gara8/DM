CREATE TABLE `accounts` (
	`userId` text NOT NULL,
	`type` text NOT NULL,
	`provider` text NOT NULL,
	`providerAccountId` text NOT NULL,
	`refresh_token` text,
	`access_token` text,
	`expires_at` integer,
	`token_type` text,
	`scope` text,
	`id_token` text,
	`session_state` text,
	PRIMARY KEY(`provider`, `providerAccountId`),
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `alerts` (
	`id` text PRIMARY KEY NOT NULL,
	`signalEventId` text NOT NULL,
	`ticker` text NOT NULL,
	`timeframe` text NOT NULL,
	`priority` text NOT NULL,
	`message` text NOT NULL,
	`dedupeKey` text NOT NULL,
	`createdAt` text NOT NULL,
	`readBy` text DEFAULT '[]',
	FOREIGN KEY (`signalEventId`) REFERENCES `signal_events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `alerts_dedupeKey_unique` ON `alerts` (`dedupeKey`);--> statement-breakpoint
CREATE TABLE `bars` (
	`ticker` text NOT NULL,
	`timeframe` text NOT NULL,
	`date` text NOT NULL,
	`open` real NOT NULL,
	`high` real NOT NULL,
	`low` real NOT NULL,
	`close` real NOT NULL,
	`volume` real,
	`fetchedAt` text NOT NULL,
	PRIMARY KEY(`ticker`, `timeframe`, `date`)
);
--> statement-breakpoint
CREATE INDEX `bars_ticker_tf` ON `bars` (`ticker`,`timeframe`);--> statement-breakpoint
CREATE TABLE `hero_history` (
	`userId` text NOT NULL,
	`date` text NOT NULL,
	`ticker` text NOT NULL,
	`timeframe` text NOT NULL,
	`indicator` text NOT NULL,
	PRIMARY KEY(`userId`, `date`),
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `scan_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`trigger` text NOT NULL,
	`triggeredBy` text,
	`startedAt` text NOT NULL,
	`finishedAt` text,
	`tickersAttempted` integer DEFAULT 0 NOT NULL,
	`tickersSucceeded` integer DEFAULT 0 NOT NULL,
	`errors` text DEFAULT '[]',
	FOREIGN KEY (`triggeredBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`sessionToken` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`expires` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `signal_events` (
	`id` text PRIMARY KEY NOT NULL,
	`ticker` text NOT NULL,
	`timeframe` text NOT NULL,
	`indicator` text NOT NULL,
	`eventType` text NOT NULL,
	`direction` text,
	`count` integer,
	`barDate` text NOT NULL,
	`firstKnownAtDate` text NOT NULL,
	`configHash` text NOT NULL,
	`meta` text,
	`createdAt` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `signal_events_ticker_tf` ON `signal_events` (`ticker`,`timeframe`);--> statement-breakpoint
CREATE INDEX `signal_events_bar_date` ON `signal_events` (`barDate`);--> statement-breakpoint
CREATE INDEX `signal_events_first_known` ON `signal_events` (`firstKnownAtDate`);--> statement-breakpoint
CREATE INDEX `signal_events_natural` ON `signal_events` (`ticker`,`timeframe`,`indicator`,`eventType`,`barDate`);--> statement-breakpoint
CREATE TABLE `signal_hit_rates` (
	`ticker` text NOT NULL,
	`timeframe` text NOT NULL,
	`indicator` text NOT NULL,
	`signalType` text NOT NULL,
	`n` integer NOT NULL,
	`hits` integer NOT NULL,
	`avgReturnPct` real,
	`horizon` text NOT NULL,
	`lastComputedAt` text NOT NULL,
	PRIMARY KEY(`ticker`, `timeframe`, `indicator`, `signalType`)
);
--> statement-breakpoint
CREATE TABLE `signal_states` (
	`ticker` text NOT NULL,
	`timeframe` text NOT NULL,
	`indicator` text NOT NULL,
	`direction` text,
	`phase` text DEFAULT 'none' NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`isPerfected` integer DEFAULT false NOT NULL,
	`isDeferred` integer DEFAULT false NOT NULL,
	`countdownBar8Close` real,
	`tdstLevel` real,
	`tdstAnchorBarDate` text,
	`riskLevel` real,
	`barsSince9` integer,
	`barsSince13` integer,
	`configHash` text NOT NULL,
	`engineStateJson` text,
	`asOfBarDate` text NOT NULL,
	`updatedAt` text NOT NULL,
	PRIMARY KEY(`ticker`, `timeframe`, `indicator`)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`image` text,
	`emailVerified` integer,
	`createdAt` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `verificationTokens` (
	`identifier` text NOT NULL,
	`token` text NOT NULL,
	`expires` integer NOT NULL,
	PRIMARY KEY(`identifier`, `token`)
);
--> statement-breakpoint
CREATE TABLE `watchlist_tickers` (
	`watchlistId` text NOT NULL,
	`ticker` text NOT NULL,
	`tags` text DEFAULT '[]',
	`addedBy` text NOT NULL,
	`addedAt` text NOT NULL,
	`isActive` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`watchlistId`, `ticker`),
	FOREIGN KEY (`watchlistId`) REFERENCES `watchlists`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`addedBy`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `watchlists` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`createdAt` text NOT NULL
);
