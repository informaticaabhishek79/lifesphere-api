CREATE TABLE "assistant_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"document_folder_ids" uuid[] DEFAULT '{}' NOT NULL,
	"speak_answers" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assistant_settings" ADD CONSTRAINT "assistant_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;