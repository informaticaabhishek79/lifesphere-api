ALTER TABLE "user_preferences" ADD COLUMN "home_mode" varchar(20);--> statement-breakpoint
ALTER TABLE "check_in_schedules" ADD COLUMN "purpose" varchar(20) DEFAULT 'wellbeing' NOT NULL;--> statement-breakpoint
ALTER TABLE "contact_invitations" ADD COLUMN "requested_scopes" text[] DEFAULT '{}'::text[] NOT NULL;