CREATE TYPE "public"."care_suggestion_status" AS ENUM('pending', 'approved', 'declined', 'withdrawn');--> statement-breakpoint
ALTER TYPE "public"."grant_scope" ADD VALUE 'checkins.suggest';--> statement-breakpoint
CREATE TABLE "care_suggestions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"target_user_id" uuid NOT NULL,
	"proposed_by" uuid NOT NULL,
	"kind" varchar(40) NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "care_suggestion_status" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"result_schedule_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "care_suggestions" ADD CONSTRAINT "care_suggestions_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_suggestions" ADD CONSTRAINT "care_suggestions_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "care_suggestions" ADD CONSTRAINT "care_suggestions_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "care_suggestion_target_idx" ON "care_suggestions" USING btree ("target_user_id","status");--> statement-breakpoint
CREATE INDEX "care_suggestion_by_idx" ON "care_suggestions" USING btree ("proposed_by","status");