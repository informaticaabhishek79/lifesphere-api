CREATE TYPE "public"."inbox_import_status" AS ENUM('queued', 'processing', 'done', 'needs_review', 'failed', 'skipped', 'undone');--> statement-breakpoint
CREATE TABLE "inbox_imports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"file_id" uuid,
	"file_name" varchar(200) NOT NULL,
	"file_sha256" varchar(64) NOT NULL,
	"folder_hint" varchar(40),
	"status" "inbox_import_status" DEFAULT 'queued' NOT NULL,
	"category" varchar(40),
	"summary" text,
	"created_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"suggestions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"skipped_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" varchar(300),
	"reader" varchar(20),
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"undone_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "inbox_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"folder_id" uuid,
	"enabled" boolean DEFAULT true NOT NULL,
	"ai_consent_at" timestamp with time zone,
	"household_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "inbox_imports" ADD CONSTRAINT "inbox_imports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_imports" ADD CONSTRAINT "inbox_imports_file_id_doc_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."doc_files"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_settings" ADD CONSTRAINT "inbox_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_settings" ADD CONSTRAINT "inbox_settings_folder_id_doc_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."doc_folders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_settings" ADD CONSTRAINT "inbox_settings_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbox_imports_user_idx" ON "inbox_imports" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_imports_file_uq" ON "inbox_imports" USING btree ("file_id");