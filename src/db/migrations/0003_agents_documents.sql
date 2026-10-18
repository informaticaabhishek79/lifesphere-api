CREATE TYPE "public"."agent_kind" AS ENUM('email', 'documents');--> statement-breakpoint
CREATE TYPE "public"."agent_run_status" AS ENUM('awaiting_approval', 'sent', 'completed', 'failed', 'discarded');--> statement-breakpoint
CREATE TYPE "public"."agent_status" AS ENUM('active', 'paused');--> statement-breakpoint
CREATE TYPE "public"."folder_access" AS ENUM('read', 'edit');--> statement-breakpoint
CREATE TYPE "public"."mail_provider" AS ENUM('demo', 'gmail', 'outlook');--> statement-breakpoint
CREATE TABLE "agent_folder_grants" (
	"agent_id" uuid NOT NULL,
	"folder_id" uuid NOT NULL,
	"access" "folder_access" DEFAULT 'read' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_folder_grants_agent_id_folder_id_pk" PRIMARY KEY("agent_id","folder_id")
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"agent_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"request" text NOT NULL,
	"target_ref" varchar(300),
	"target_label" varchar(300),
	"status" "agent_run_status" NOT NULL,
	"output" text,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error" varchar(300),
	"ai_model" varchar(80),
	"simulated" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"kind" "agent_kind" NOT NULL,
	"name" varchar(80) NOT NULL,
	"instructions" text,
	"status" "agent_status" DEFAULT 'active' NOT NULL,
	"mail_account_id" uuid,
	"review_before_sending" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "doc_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"folder_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"mime_type" varchar(120) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"storage_key" varchar(300) NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"text_content" text,
	"last_changed_by_agent_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "doc_folders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" varchar(120) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mail_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"provider" "mail_provider" NOT NULL,
	"address" varchar(254) NOT NULL,
	"tokens_enc" text,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"last_error" varchar(300),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mail_oauth_states" (
	"state" varchar(64) PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "mail_provider" NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_folder_grants" ADD CONSTRAINT "agent_folder_grants_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_folder_grants" ADD CONSTRAINT "agent_folder_grants_folder_id_doc_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."doc_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_mail_account_id_mail_accounts_id_fk" FOREIGN KEY ("mail_account_id") REFERENCES "public"."mail_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_files" ADD CONSTRAINT "doc_files_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_files" ADD CONSTRAINT "doc_files_folder_id_doc_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."doc_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_folders" ADD CONSTRAINT "doc_folders_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doc_folders" ADD CONSTRAINT "doc_folders_parent_id_doc_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."doc_folders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_accounts" ADD CONSTRAINT "mail_accounts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_oauth_states" ADD CONSTRAINT "mail_oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_folder_grants_folder_idx" ON "agent_folder_grants" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "agent_runs_agent_idx" ON "agent_runs" USING btree ("agent_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_runs_owner_idx" ON "agent_runs" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE INDEX "agents_owner_idx" ON "agents" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "doc_files_key_uq" ON "doc_files" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "doc_files_folder_idx" ON "doc_files" USING btree ("folder_id");--> statement-breakpoint
CREATE INDEX "doc_files_owner_idx" ON "doc_files" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "doc_folders_owner_idx" ON "doc_folders" USING btree ("owner_user_id","parent_id");--> statement-breakpoint
CREATE INDEX "mail_accounts_owner_idx" ON "mail_accounts" USING btree ("owner_user_id");