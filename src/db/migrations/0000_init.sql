CREATE EXTENSION IF NOT EXISTS citext;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE SCHEMA "auth";
--> statement-breakpoint
CREATE TYPE "public"."actor_type" AS ENUM('user', 'staff', 'system');--> statement-breakpoint
CREATE TYPE "public"."ai_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."appeal_status" AS ENUM('open', 'upheld', 'overturned');--> statement-breakpoint
CREATE TYPE "public"."article_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."assignment_status" AS ENUM('proposed', 'accepted', 'declined');--> statement-breakpoint
CREATE TYPE "public"."attachment_purpose" AS ENUM('task', 'post', 'consumer_case', 'inventory', 'export', 'avatar', 'provider', 'civic');--> statement-breakpoint
CREATE TYPE "public"."attachment_status" AS ENUM('pending', 'ready', 'quarantined', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."attendee_status" AS ENUM('invited', 'accepted', 'declined', 'tentative');--> statement-breakpoint
CREATE TYPE "public"."calendar_event_kind" AS ENUM('appointment', 'visit', 'errand', 'activity', 'other');--> statement-breakpoint
CREATE TYPE "public"."case_event_kind" AS ENUM('note', 'contact', 'response', 'status_change', 'follow_up');--> statement-breakpoint
CREATE TYPE "public"."check_in_event_state" AS ENUM('pending', 'reminded', 'completed', 'missed', 'escalated', 'acknowledged', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."check_in_kind" AS ENUM('daily', 'weekly', 'one_off', 'visit_confirmation', 'assistance_confirmation');--> statement-breakpoint
CREATE TYPE "public"."civic_category" AS ENUM('streetlight', 'garbage', 'road', 'water', 'drainage', 'electricity', 'public_safety', 'other');--> statement-breakpoint
CREATE TYPE "public"."civic_status" AS ENUM('draft', 'reported_by_user', 'in_progress', 'resolved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."consumer_case_status" AS ENUM('draft', 'ready_to_submit', 'submitted_by_user', 'awaiting_response', 'info_required', 'resolved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."content_status" AS ENUM('published', 'hidden', 'removed', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."device_platform" AS ENUM('web', 'android', 'ios');--> statement-breakpoint
CREATE TYPE "public"."draft_source" AS ENUM('user', 'ai');--> statement-breakpoint
CREATE TYPE "public"."feedback_rating" AS ENUM('up', 'down');--> statement-breakpoint
CREATE TYPE "public"."grant_scope" AS ENUM('tasks.view', 'tasks.assign', 'calendar.view', 'checkins.view', 'checkins.alerts', 'help.alerts', 'help.location');--> statement-breakpoint
CREATE TYPE "public"."grant_status" AS ENUM('pending_cooloff', 'active', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."group_role" AS ENUM('owner', 'admin', 'moderator', 'member');--> statement-breakpoint
CREATE TYPE "public"."group_status" AS ENUM('active', 'suspended', 'archived');--> statement-breakpoint
CREATE TYPE "public"."group_visibility" AS ENUM('public', 'private', 'invite_only');--> statement-breakpoint
CREATE TYPE "public"."help_request_kind" AS ENUM('notify_contacts', 'call', 'service_request');--> statement-breakpoint
CREATE TYPE "public"."help_request_status" AS ENUM('open', 'acknowledged', 'resolved', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."household_role" AS ENUM('admin', 'member');--> statement-breakpoint
CREATE TYPE "public"."invitation_status" AS ENUM('pending', 'accepted', 'declined', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."lock_screen_detail" AS ENUM('none', 'generic', 'full');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('active', 'pending', 'banned', 'left');--> statement-breakpoint
CREATE TYPE "public"."moderation_action_kind" AS ENUM('hide', 'remove', 'restore', 'warn', 'suspend_posting', 'suspend', 'ban', 'dismiss');--> statement-breakpoint
CREATE TYPE "public"."notification_category" AS ENUM('reminders', 'tasks', 'household', 'family', 'checkins', 'help', 'community', 'services', 'consumer', 'security', 'privacy', 'system');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('in_app', 'push', 'sms', 'email');--> statement-breakpoint
CREATE TYPE "public"."notification_job_status" AS ENUM('queued', 'sending', 'sent', 'delivered', 'failed', 'suppressed', 'simulated');--> statement-breakpoint
CREATE TYPE "public"."official_channel_kind" AS ENUM('consumer', 'civic', 'government', 'helpline');--> statement-breakpoint
CREATE TYPE "public"."otp_channel" AS ENUM('sms', 'email');--> statement-breakpoint
CREATE TYPE "public"."otp_purpose" AS ENUM('login', 'verify_email', 'verify_phone', 'reauth');--> statement-breakpoint
CREATE TYPE "public"."post_kind" AS ENUM('text', 'announcement', 'event', 'recommendation', 'help_request', 'civic_info', 'lost_found');--> statement-breakpoint
CREATE TYPE "public"."posting_policy" AS ENUM('all_members', 'admins_only');--> statement-breakpoint
CREATE TYPE "public"."privacy_request_status" AS ENUM('received', 'in_progress', 'completed', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."privacy_request_type" AS ENUM('export', 'delete', 'correction', 'grievance');--> statement-breakpoint
CREATE TYPE "public"."provider_member_role" AS ENUM('owner', 'staff');--> statement-breakpoint
CREATE TYPE "public"."provider_status" AS ENUM('draft', 'pending_review', 'active', 'suspended', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."provider_type" AS ENUM('individual', 'business', 'volunteer', 'organisation');--> statement-breakpoint
CREATE TYPE "public"."reaction_kind" AS ENUM('like', 'helpful', 'thanks', 'support');--> statement-breakpoint
CREATE TYPE "public"."reminder_status" AS ENUM('scheduled', 'sent', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."report_reason" AS ENUM('spam', 'harassment', 'hate', 'fraud', 'impersonation', 'privacy', 'unsafe', 'misinformation', 'other');--> statement-breakpoint
CREATE TYPE "public"."report_status" AS ENUM('open', 'in_review', 'actioned', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."report_target_type" AS ENUM('post', 'comment', 'user', 'group', 'provider', 'service_request', 'review');--> statement-breakpoint
CREATE TYPE "public"."sanction_kind" AS ENUM('warning', 'posting_suspended', 'suspended', 'banned');--> statement-breakpoint
CREATE TYPE "public"."service_request_status" AS ENUM('requested', 'accepted', 'declined', 'scheduled', 'in_progress', 'completed', 'cancelled', 'disputed');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('official', 'ngo', 'internal', 'other');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('support', 'moderator', 'privacy_officer', 'provider_reviewer', 'content_admin', 'super_admin');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."subscription_subject" AS ENUM('user', 'household', 'provider');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('low', 'normal', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('pending', 'in_progress', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."task_visibility" AS ENUM('private', 'household', 'shared');--> statement-breakpoint
CREATE TYPE "public"."theme_preference" AS ENUM('system', 'light', 'dark', 'high_contrast');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'disabled', 'pending_deletion', 'deleted');--> statement-breakpoint
CREATE TYPE "public"."verification_check_type" AS ENUM('identity', 'address', 'background', 'business_registration', 'reference', 'training');--> statement-breakpoint
CREATE TYPE "public"."verification_level" AS ENUM('none', 'basic', 'screened');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('pending', 'passed', 'failed', 'expired');--> statement-breakpoint
CREATE TABLE "localities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(120) NOT NULL,
	"city" varchar(80) NOT NULL,
	"state" varchar(80) NOT NULL,
	"country" varchar(2) DEFAULT 'IN' NOT NULL,
	"pincode_prefix" varchar(3),
	"lat" varchar(12),
	"lng" varchar(12),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."mfa_factors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(20) DEFAULT 'totp' NOT NULL,
	"secret_encrypted" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"last_used_step" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"user_id" uuid NOT NULL,
	"category" "notification_category" NOT NULL,
	"in_app" boolean DEFAULT true NOT NULL,
	"push" boolean DEFAULT true NOT NULL,
	"email" boolean DEFAULT false NOT NULL,
	"sms" boolean DEFAULT false NOT NULL,
	"bypass_quiet_hours" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_user_id_category_pk" PRIMARY KEY("user_id","category")
);
--> statement-breakpoint
CREATE TABLE "auth"."otp_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"channel" "otp_channel" NOT NULL,
	"purpose" "otp_purpose" NOT NULL,
	"destination_hash" varchar(64) NOT NULL,
	"destination_enc" text NOT NULL,
	"user_id" uuid,
	"code_hash" varchar(64) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"ip_hash" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."recovery_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"refresh_token_hash" varchar(64) NOT NULL,
	"family_id" uuid NOT NULL,
	"previous_token_hash" varchar(64),
	"device_name" varchar(120),
	"platform" varchar(20),
	"user_agent" varchar(300),
	"ip_hash" varchar(64),
	"amr" text[] DEFAULT '{}'::text[] NOT NULL,
	"mfa_verified_at" timestamp with time zone,
	"reauth_at" timestamp with time zone,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" varchar(60),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "staff_role" NOT NULL,
	"granted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"theme" "theme_preference" DEFAULT 'system' NOT NULL,
	"accessibility" jsonb DEFAULT '{"textScale":1,"highContrast":false,"reduceMotion":false,"voiceNavigation":false,"screenReaderHints":false,"simpleConfirmations":true}'::jsonb NOT NULL,
	"dashboard_widgets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"disabled_features" text[] DEFAULT '{}'::text[] NOT NULL,
	"lock_screen_detail" "lock_screen_detail" DEFAULT 'generic' NOT NULL,
	"quiet_hours_start" time,
	"quiet_hours_end" time,
	"ai_enabled" boolean DEFAULT true NOT NULL,
	"ai_store_history" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"display_name" varchar(80) NOT NULL,
	"avatar_attachment_id" uuid,
	"locale" varchar(10) DEFAULT 'en-IN' NOT NULL,
	"timezone" varchar(60) DEFAULT 'Asia/Kolkata' NOT NULL,
	"senior_mode" boolean DEFAULT false NOT NULL,
	"discoverable" boolean DEFAULT false NOT NULL,
	"locality_id" uuid,
	"bio" varchar(280),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"phone_e164" varchar(20),
	"email" "citext",
	"phone_verified_at" timestamp with time zone,
	"email_verified_at" timestamp with time zone,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"disabled_reason" text,
	"age_confirmed_at" timestamp with time zone,
	"last_active_at" timestamp with time zone,
	"deletion_requested_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "app_config" (
	"key" varchar(80) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"description" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"purpose" "attachment_purpose" NOT NULL,
	"storage_key" varchar(300) NOT NULL,
	"original_name" varchar(200),
	"mime_type" varchar(100) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"status" "attachment_status" DEFAULT 'ready' NOT NULL,
	"temporary" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_id" uuid,
	"actor_type" "actor_type" NOT NULL,
	"action" varchar(80) NOT NULL,
	"target_type" varchar(40),
	"target_id" uuid,
	"subject_user_id" uuid,
	"ip_hash" varchar(64),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" varchar(60) NOT NULL,
	"policy_version" varchar(20) NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"source" varchar(30) DEFAULT 'app' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"key" varchar(100) NOT NULL,
	"method" varchar(10) NOT NULL,
	"path" varchar(300) NOT NULL,
	"request_hash" varchar(64) NOT NULL,
	"response_status" integer,
	"response_body" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" uuid,
	"platform" "device_platform" NOT NULL,
	"token" text NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"label" varchar(80),
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"category" "notification_category" NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"template" varchar(60) NOT NULL,
	"status" "notification_job_status" DEFAULT 'queued' NOT NULL,
	"provider" varchar(30),
	"provider_message_id" varchar(120),
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" varchar(300),
	"scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"related_type" varchar(40),
	"related_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"category" "notification_category" NOT NULL,
	"title" varchar(160) NOT NULL,
	"body" varchar(500),
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"code" varchar(40) PRIMARY KEY NOT NULL,
	"name" varchar(80) NOT NULL,
	"subject" "subscription_subject" NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "privacy_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"type" "privacy_request_type" NOT NULL,
	"status" "privacy_request_status" DEFAULT 'received' NOT NULL,
	"details" text,
	"result_attachment_id" uuid,
	"due_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"handled_by" uuid,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_type" "subscription_subject" NOT NULL,
	"subject_id" uuid NOT NULL,
	"plan_code" varchar(40) NOT NULL,
	"status" "subscription_status" DEFAULT 'active' NOT NULL,
	"source" varchar(30) DEFAULT 'manual' NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"household_id" uuid,
	"kind" "calendar_event_kind" DEFAULT 'other' NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"all_day" boolean DEFAULT false NOT NULL,
	"location_text" varchar(200),
	"recurrence_rule" varchar(300),
	"visibility" "task_visibility" DEFAULT 'private' NOT NULL,
	"visit_for_user_id" uuid,
	"created_by" uuid,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_attendees" (
	"event_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "attendee_status" DEFAULT 'invited' NOT NULL,
	"responded_at" timestamp with time zone,
	CONSTRAINT "event_attendees_event_id_user_id_pk" PRIMARY KEY("event_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "family_announcements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" varchar(1000) NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "home_inventory_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"household_id" uuid,
	"name" varchar(120) NOT NULL,
	"category" varchar(40) NOT NULL,
	"brand" varchar(60),
	"model" varchar(80),
	"room_or_location" varchar(60),
	"installed_on" date,
	"purchase_date" date,
	"warranty_expires_on" date,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "household_budgets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"household_id" uuid,
	"month" date NOT NULL,
	"category" varchar(40) NOT NULL,
	"planned_amount" numeric(12, 2) NOT NULL,
	"spent_amount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"currency" varchar(3) DEFAULT 'INR' NOT NULL,
	"note" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "household_invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"invited_by" uuid NOT NULL,
	"invitee_contact_hash" varchar(64),
	"invitee_user_id" uuid,
	"role" "household_role" DEFAULT 'member' NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "household_members" (
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "household_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_members_household_id_user_id_pk" PRIMARY KEY("household_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "households" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(80) NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "maintenance_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"schedule_id" uuid,
	"performed_on" date NOT NULL,
	"description" varchar(500) NOT NULL,
	"provider_name" varchar(120),
	"provider_id" uuid,
	"service_request_id" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "maintenance_schedules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"title" varchar(120) NOT NULL,
	"interval_days" integer NOT NULL,
	"next_due_on" date NOT NULL,
	"reminder_lead_days" integer DEFAULT 3 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_reminder_for" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"task_id" uuid,
	"event_id" uuid,
	"title" varchar(200) NOT NULL,
	"fire_at" timestamp with time zone NOT NULL,
	"channels" text[] DEFAULT '{in_app,push}'::text[] NOT NULL,
	"status" "reminder_status" DEFAULT 'scheduled' NOT NULL,
	"job_id" varchar(64),
	"sent_at" timestamp with time zone,
	"last_error" varchar(300),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopping_list_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"list_id" uuid NOT NULL,
	"name" varchar(120) NOT NULL,
	"quantity" numeric(10, 2),
	"unit" varchar(20),
	"category" varchar(40),
	"assigned_to" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"done_at" timestamp with time zone,
	"done_by" uuid,
	"added_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopping_lists" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"household_id" uuid,
	"name" varchar(80) NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"task_id" uuid NOT NULL,
	"assignee_user_id" uuid NOT NULL,
	"assigned_by" uuid NOT NULL,
	"status" "assignment_status" DEFAULT 'proposed' NOT NULL,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_attachments" (
	"task_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	CONSTRAINT "task_attachments_task_id_attachment_id_pk" PRIMARY KEY("task_id","attachment_id")
);
--> statement-breakpoint
CREATE TABLE "task_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid,
	"household_id" uuid,
	"name" varchar(40) NOT NULL,
	"color" varchar(9),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_cat_owner_ck" CHECK (("task_categories"."owner_user_id" is not null) <> ("task_categories"."household_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"household_id" uuid,
	"title" varchar(200) NOT NULL,
	"notes" text,
	"category_id" uuid,
	"priority" "task_priority" DEFAULT 'normal' NOT NULL,
	"status" "task_status" DEFAULT 'pending' NOT NULL,
	"visibility" "task_visibility" DEFAULT 'private' NOT NULL,
	"due_at" timestamp with time zone,
	"all_day" boolean DEFAULT false NOT NULL,
	"recurrence_rule" varchar(300),
	"series_id" uuid,
	"is_chore" boolean DEFAULT false NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "access_grants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"grantor_id" uuid NOT NULL,
	"grantee_id" uuid NOT NULL,
	"scope" "grant_scope" NOT NULL,
	"status" "grant_status" DEFAULT 'pending_cooloff' NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "alert_deliveries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"alert_type" varchar(30) NOT NULL,
	"alert_id" uuid NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"notification_job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "check_in_escalation_contacts" (
	"schedule_id" uuid NOT NULL,
	"contact_user_id" uuid NOT NULL,
	"position" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "check_in_escalation_contacts_schedule_id_contact_user_id_pk" PRIMARY KEY("schedule_id","contact_user_id")
);
--> statement-breakpoint
CREATE TABLE "check_in_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"schedule_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"state" "check_in_event_state" DEFAULT 'pending' NOT NULL,
	"completed_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	"missed_at" timestamp with time zone,
	"escalated_at" timestamp with time zone,
	"acknowledged_by" uuid,
	"acknowledged_at" timestamp with time zone,
	"note" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "check_in_schedules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"label" varchar(80) NOT NULL,
	"kind" "check_in_kind" NOT NULL,
	"time_local" time,
	"days_of_week" smallint[],
	"one_off_at" timestamp with time zone,
	"timezone" varchar(60) DEFAULT 'Asia/Kolkata' NOT NULL,
	"reminder_after_minutes" integer DEFAULT 15 NOT NULL,
	"grace_minutes" integer DEFAULT 30 NOT NULL,
	"escalate" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"next_due_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"inviter_user_id" uuid NOT NULL,
	"invitee_contact_hash" varchar(64),
	"invitee_user_id" uuid,
	"proposed_scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"label" varchar(40),
	"message" varchar(300),
	"token_hash" varchar(64) NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emergency_contact_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"emergency_number" varchar(15) DEFAULT '112' NOT NULL,
	"primary_call_contact_id" uuid,
	"notify_contacts" boolean DEFAULT true NOT NULL,
	"share_location_by_default" boolean DEFAULT false NOT NULL,
	"default_message" varchar(200),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "help_request_recipients" (
	"help_request_id" uuid NOT NULL,
	"recipient_user_id" uuid NOT NULL,
	"acknowledged_at" timestamp with time zone,
	CONSTRAINT "help_request_recipients_help_request_id_recipient_user_id_pk" PRIMARY KEY("help_request_id","recipient_user_id")
);
--> statement-breakpoint
CREATE TABLE "help_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "help_request_kind" NOT NULL,
	"message" varchar(300),
	"location_lat" varchar(12),
	"location_lng" varchar(12),
	"location_expires_at" timestamp with time zone,
	"status" "help_request_status" DEFAULT 'open' NOT NULL,
	"service_request_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trusted_contacts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"contact_user_id" uuid NOT NULL,
	"label" varchar(40),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "case_attachments" (
	"case_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	CONSTRAINT "case_attachments_case_id_attachment_id_pk" PRIMARY KEY("case_id","attachment_id")
);
--> statement-breakpoint
CREATE TABLE "complaint_drafts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"case_id" uuid NOT NULL,
	"body" text NOT NULL,
	"source" "draft_source" NOT NULL,
	"ai_model" varchar(80),
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consumer_case_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"case_id" uuid NOT NULL,
	"kind" "case_event_kind" NOT NULL,
	"occurred_on" date NOT NULL,
	"description" varchar(1000) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consumer_cases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"purchase_id" uuid,
	"title" varchar(200) NOT NULL,
	"counterparty_name" varchar(120),
	"category" varchar(60),
	"status" "consumer_case_status" DEFAULT 'draft' NOT NULL,
	"external_reference" varchar(80),
	"official_channel_id" uuid,
	"submitted_at" timestamp with time zone,
	"next_follow_up_on" date,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "official_channels" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" "official_channel_kind" NOT NULL,
	"name" varchar(160) NOT NULL,
	"jurisdiction" varchar(120) DEFAULT 'India' NOT NULL,
	"topics" text[],
	"url" varchar(400),
	"phone" varchar(40),
	"description" text,
	"last_reviewed_on" date,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"household_id" uuid,
	"inventory_item_id" uuid,
	"product_category" varchar(60) NOT NULL,
	"brand" varchar(60),
	"model" varchar(80),
	"purchase_date" date,
	"retailer_name" varchar(120),
	"warranty_expires_on" date,
	"return_deadline" date,
	"service_reference" varchar(80),
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "bookmarks" (
	"user_id" uuid NOT NULL,
	"post_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookmarks_user_id_post_id_pk" PRIMARY KEY("user_id","post_id")
);
--> statement-breakpoint
CREATE TABLE "civic_issues" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reporter_id" uuid NOT NULL,
	"locality_id" uuid,
	"category" "civic_category" NOT NULL,
	"description" varchar(1000) NOT NULL,
	"location_text" varchar(200),
	"status" "civic_status" DEFAULT 'draft' NOT NULL,
	"official_channel_id" uuid,
	"external_reference" varchar(80),
	"reported_at" timestamp with time zone,
	"post_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"post_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"parent_comment_id" uuid,
	"body" varchar(2000) NOT NULL,
	"status" "content_status" DEFAULT 'published' NOT NULL,
	"edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(120) NOT NULL,
	"description" varchar(1000),
	"visibility" "group_visibility" DEFAULT 'private' NOT NULL,
	"category" varchar(40),
	"locality_id" uuid,
	"posting_policy" "posting_policy" DEFAULT 'all_members' NOT NULL,
	"status" "group_status" DEFAULT 'active' NOT NULL,
	"rules" text,
	"member_count" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reporter_id" uuid,
	"source" varchar(20) DEFAULT 'user' NOT NULL,
	"target_type" "report_target_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"target_user_id" uuid,
	"group_id" uuid,
	"reason" "report_reason" NOT NULL,
	"details" varchar(1000),
	"status" "report_status" DEFAULT 'open' NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"assigned_to" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_snapshots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"report_id" uuid NOT NULL,
	"target_type" "report_target_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"snapshot" jsonb NOT NULL,
	"retain_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"invited_by" uuid NOT NULL,
	"invitee_user_id" uuid,
	"token_hash" varchar(64) NOT NULL,
	"status" "invitation_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "group_memberships" (
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "group_role" DEFAULT 'member' NOT NULL,
	"status" "membership_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_memberships_group_id_user_id_pk" PRIMARY KEY("group_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "moderation_actions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"report_id" uuid,
	"moderator_id" uuid,
	"target_type" "report_target_type" NOT NULL,
	"target_id" uuid NOT NULL,
	"target_user_id" uuid,
	"action" "moderation_action_kind" NOT NULL,
	"reason" varchar(500) NOT NULL,
	"scope" varchar(10) DEFAULT 'platform' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "moderation_appeals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"action_id" uuid NOT NULL,
	"appellant_id" uuid NOT NULL,
	"statement" varchar(2000) NOT NULL,
	"status" "appeal_status" DEFAULT 'open' NOT NULL,
	"decided_by" uuid,
	"decision_note" varchar(1000),
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "post_attachments" (
	"post_id" uuid NOT NULL,
	"attachment_id" uuid NOT NULL,
	CONSTRAINT "post_attachments_post_id_attachment_id_pk" PRIMARY KEY("post_id","attachment_id")
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"group_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"kind" "post_kind" DEFAULT 'text' NOT NULL,
	"title" varchar(200),
	"body" text NOT NULL,
	"event_starts_at" timestamp with time zone,
	"event_ends_at" timestamp with time zone,
	"event_location_text" varchar(200),
	"status" "content_status" DEFAULT 'published' NOT NULL,
	"removed_reason" varchar(200),
	"comment_count" integer DEFAULT 0 NOT NULL,
	"reaction_count" integer DEFAULT 0 NOT NULL,
	"pinned_at" timestamp with time zone,
	"edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reactions" (
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "reaction_kind" DEFAULT 'like' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reactions_post_id_user_id_pk" PRIMARY KEY("post_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "user_blocks" (
	"blocker_id" uuid NOT NULL,
	"blocked_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_blocks_blocker_id_blocked_id_pk" PRIMARY KEY("blocker_id","blocked_id")
);
--> statement-breakpoint
CREATE TABLE "user_sanctions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "sanction_kind" NOT NULL,
	"reason" varchar(500) NOT NULL,
	"action_id" uuid,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"lifted_at" timestamp with time zone,
	"lifted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_members" (
	"provider_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "provider_member_role" DEFAULT 'staff' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_members_provider_id_user_id_pk" PRIMARY KEY("provider_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "provider_reviews" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"provider_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"body" varchar(1000),
	"status" "content_status" DEFAULT 'published' NOT NULL,
	"provider_response" varchar(1000),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_rating_ck" CHECK ("provider_reviews"."rating" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "provider_service_areas" (
	"provider_id" uuid NOT NULL,
	"locality_id" uuid NOT NULL,
	CONSTRAINT "provider_service_areas_provider_id_locality_id_pk" PRIMARY KEY("provider_id","locality_id")
);
--> statement-breakpoint
CREATE TABLE "provider_services" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	"title" varchar(120) NOT NULL,
	"description" varchar(1000),
	"price_note" varchar(200),
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_verification_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider_id" uuid NOT NULL,
	"check_type" "verification_check_type" NOT NULL,
	"status" "verification_status" DEFAULT 'pending' NOT NULL,
	"performed_by_partner" varchar(120),
	"reviewer_id" uuid,
	"note" varchar(500),
	"checked_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" varchar(60) NOT NULL,
	"name" varchar(80) NOT NULL,
	"description" varchar(500),
	"parent_id" uuid,
	"requires_verification" boolean DEFAULT false NOT NULL,
	"senior_support" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_providers" (
	"id" uuid PRIMARY KEY NOT NULL,
	"display_name" varchar(120) NOT NULL,
	"provider_type" "provider_type" NOT NULL,
	"description" text,
	"phone_public" varchar(20),
	"email_public" varchar(160),
	"website_url" varchar(300),
	"status" "provider_status" DEFAULT 'draft' NOT NULL,
	"verification_level" "verification_level" DEFAULT 'none' NOT NULL,
	"is_sponsored" boolean DEFAULT false NOT NULL,
	"sponsored_until" timestamp with time zone,
	"rejection_reason" varchar(500),
	"submitted_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_request_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"actor_id" uuid,
	"from_status" "service_request_status",
	"to_status" "service_request_status" NOT NULL,
	"note" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"requester_id" uuid NOT NULL,
	"on_behalf_of_user_id" uuid,
	"provider_id" uuid,
	"provider_service_id" uuid,
	"category_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" varchar(2000),
	"locality_id" uuid,
	"location_note" varchar(300),
	"preferred_start" timestamp with time zone,
	"preferred_end" timestamp with time zone,
	"scheduled_at" timestamp with time zone,
	"status" "service_request_status" DEFAULT 'requested' NOT NULL,
	"status_reason" varchar(300),
	"inventory_item_id" uuid,
	"consumer_case_id" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"title" varchar(120),
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_eval_cases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"question" varchar(500) NOT NULL,
	"expected_article_ids" uuid[] NOT NULL,
	"must_not_contain" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_eval_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"started_by" uuid,
	"total_cases" integer NOT NULL,
	"retrieval_hits" integer NOT NULL,
	"results" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_feedback" (
	"id" uuid PRIMARY KEY NOT NULL,
	"message_id" uuid,
	"user_id" uuid NOT NULL,
	"rating" "feedback_rating" NOT NULL,
	"reason" varchar(60),
	"comment" varchar(1000),
	"cited_article_ids" uuid[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" "ai_role" NOT NULL,
	"content" text NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"proposed_actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_articles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"source_id" uuid NOT NULL,
	"slug" varchar(160) NOT NULL,
	"title" varchar(240) NOT NULL,
	"summary" varchar(1000),
	"body" text NOT NULL,
	"canonical_url" varchar(400),
	"topic" varchar(60) NOT NULL,
	"language" varchar(10) DEFAULT 'en' NOT NULL,
	"published_on" date,
	"last_reviewed_on" date,
	"status" "article_status" DEFAULT 'draft' NOT NULL,
	"disclaimer" varchar(300),
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce("knowledge_articles"."title", '')), 'A') || setweight(to_tsvector('english', coalesce("knowledge_articles"."summary", '')), 'B') || setweight(to_tsvector('english', coalesce("knowledge_articles"."body", '')), 'C')) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_chunks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"article_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"heading" varchar(240),
	"content" text NOT NULL,
	"token_count" integer NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce("knowledge_chunks"."heading", '') || ' ' || "knowledge_chunks"."content")) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(160) NOT NULL,
	"publisher" varchar(160),
	"url" varchar(400),
	"kind" "source_kind" NOT NULL,
	"reliability_tier" smallint DEFAULT 2 NOT NULL,
	"reliability_note" varchar(500),
	"active" boolean DEFAULT true NOT NULL,
	"review_interval_days" integer DEFAULT 180 NOT NULL,
	"last_ingested_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth"."mfa_factors" ADD CONSTRAINT "mfa_factors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."otp_challenges" ADD CONSTRAINT "otp_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."recovery_codes" ADD CONSTRAINT "recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_roles" ADD CONSTRAINT "staff_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_roles" ADD CONSTRAINT "staff_roles_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_locality_id_localities_id_fk" FOREIGN KEY ("locality_id") REFERENCES "public"."localities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_config" ADD CONSTRAINT "app_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_devices" ADD CONSTRAINT "notification_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_jobs" ADD CONSTRAINT "notification_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_code_plans_code_fk" FOREIGN KEY ("plan_code") REFERENCES "public"."plans"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_visit_for_user_id_users_id_fk" FOREIGN KEY ("visit_for_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_events" ADD CONSTRAINT "calendar_events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_attendees" ADD CONSTRAINT "event_attendees_event_id_calendar_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_attendees" ADD CONSTRAINT "event_attendees_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_announcements" ADD CONSTRAINT "family_announcements_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_announcements" ADD CONSTRAINT "family_announcements_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "home_inventory_items" ADD CONSTRAINT "home_inventory_items_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "home_inventory_items" ADD CONSTRAINT "home_inventory_items_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_budgets" ADD CONSTRAINT "household_budgets_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_budgets" ADD CONSTRAINT "household_budgets_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_invitations" ADD CONSTRAINT "household_invitations_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_invitations" ADD CONSTRAINT "household_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_invitations" ADD CONSTRAINT "household_invitations_invitee_user_id_users_id_fk" FOREIGN KEY ("invitee_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "households" ADD CONSTRAINT "households_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_item_id_home_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."home_inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_schedule_id_maintenance_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."maintenance_schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_records" ADD CONSTRAINT "maintenance_records_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_schedules" ADD CONSTRAINT "maintenance_schedules_item_id_home_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."home_inventory_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_event_id_calendar_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_list_id_shopping_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."shopping_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_done_by_users_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_list_items" ADD CONSTRAINT "shopping_list_items_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_lists" ADD CONSTRAINT "shopping_lists_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopping_lists" ADD CONSTRAINT "shopping_lists_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_attachments" ADD CONSTRAINT "task_attachments_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_categories" ADD CONSTRAINT "task_categories_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_categories" ADD CONSTRAINT "task_categories_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_category_id_task_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."task_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_grantor_id_users_id_fk" FOREIGN KEY ("grantor_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_grantee_id_users_id_fk" FOREIGN KEY ("grantee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alert_deliveries" ADD CONSTRAINT "alert_deliveries_notification_job_id_notification_jobs_id_fk" FOREIGN KEY ("notification_job_id") REFERENCES "public"."notification_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_in_escalation_contacts" ADD CONSTRAINT "check_in_escalation_contacts_schedule_id_check_in_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."check_in_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_in_escalation_contacts" ADD CONSTRAINT "check_in_escalation_contacts_contact_user_id_users_id_fk" FOREIGN KEY ("contact_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_in_events" ADD CONSTRAINT "check_in_events_schedule_id_check_in_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."check_in_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_in_events" ADD CONSTRAINT "check_in_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_in_events" ADD CONSTRAINT "check_in_events_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_in_schedules" ADD CONSTRAINT "check_in_schedules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_invitations" ADD CONSTRAINT "contact_invitations_inviter_user_id_users_id_fk" FOREIGN KEY ("inviter_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_invitations" ADD CONSTRAINT "contact_invitations_invitee_user_id_users_id_fk" FOREIGN KEY ("invitee_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_contact_preferences" ADD CONSTRAINT "emergency_contact_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_contact_preferences" ADD CONSTRAINT "emergency_contact_preferences_primary_call_contact_id_users_id_fk" FOREIGN KEY ("primary_call_contact_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "help_request_recipients" ADD CONSTRAINT "help_request_recipients_help_request_id_help_requests_id_fk" FOREIGN KEY ("help_request_id") REFERENCES "public"."help_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "help_request_recipients" ADD CONSTRAINT "help_request_recipients_recipient_user_id_users_id_fk" FOREIGN KEY ("recipient_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "help_requests" ADD CONSTRAINT "help_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trusted_contacts" ADD CONSTRAINT "trusted_contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trusted_contacts" ADD CONSTRAINT "trusted_contacts_contact_user_id_users_id_fk" FOREIGN KEY ("contact_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_attachments" ADD CONSTRAINT "case_attachments_case_id_consumer_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."consumer_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_attachments" ADD CONSTRAINT "case_attachments_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaint_drafts" ADD CONSTRAINT "complaint_drafts_case_id_consumer_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."consumer_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumer_case_events" ADD CONSTRAINT "consumer_case_events_case_id_consumer_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."consumer_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumer_cases" ADD CONSTRAINT "consumer_cases_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumer_cases" ADD CONSTRAINT "consumer_cases_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consumer_cases" ADD CONSTRAINT "consumer_cases_official_channel_id_official_channels_id_fk" FOREIGN KEY ("official_channel_id") REFERENCES "public"."official_channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_inventory_item_id_home_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."home_inventory_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "civic_issues" ADD CONSTRAINT "civic_issues_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "civic_issues" ADD CONSTRAINT "civic_issues_locality_id_localities_id_fk" FOREIGN KEY ("locality_id") REFERENCES "public"."localities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "civic_issues" ADD CONSTRAINT "civic_issues_official_channel_id_official_channels_id_fk" FOREIGN KEY ("official_channel_id") REFERENCES "public"."official_channels"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "civic_issues" ADD CONSTRAINT "civic_issues_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_groups" ADD CONSTRAINT "community_groups_locality_id_localities_id_fk" FOREIGN KEY ("locality_id") REFERENCES "public"."localities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_groups" ADD CONSTRAINT "community_groups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_reporter_id_users_id_fk" FOREIGN KEY ("reporter_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_group_id_community_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."community_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_snapshots" ADD CONSTRAINT "content_snapshots_report_id_content_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."content_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_invitations" ADD CONSTRAINT "group_invitations_group_id_community_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."community_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_invitations" ADD CONSTRAINT "group_invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_invitations" ADD CONSTRAINT "group_invitations_invitee_user_id_users_id_fk" FOREIGN KEY ("invitee_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_group_id_community_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."community_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_memberships" ADD CONSTRAINT "group_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_report_id_content_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."content_reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_moderator_id_users_id_fk" FOREIGN KEY ("moderator_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_appeals" ADD CONSTRAINT "moderation_appeals_action_id_moderation_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."moderation_actions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_appeals" ADD CONSTRAINT "moderation_appeals_appellant_id_users_id_fk" FOREIGN KEY ("appellant_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_appeals" ADD CONSTRAINT "moderation_appeals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_attachments" ADD CONSTRAINT "post_attachments_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_attachments" ADD CONSTRAINT "post_attachments_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_group_id_community_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."community_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocker_id_users_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocked_id_users_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sanctions" ADD CONSTRAINT "user_sanctions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sanctions" ADD CONSTRAINT "user_sanctions_action_id_moderation_actions_id_fk" FOREIGN KEY ("action_id") REFERENCES "public"."moderation_actions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sanctions" ADD CONSTRAINT "user_sanctions_lifted_by_users_id_fk" FOREIGN KEY ("lifted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_members" ADD CONSTRAINT "provider_members_provider_id_service_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."service_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_members" ADD CONSTRAINT "provider_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_reviews" ADD CONSTRAINT "provider_reviews_request_id_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_reviews" ADD CONSTRAINT "provider_reviews_provider_id_service_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."service_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_reviews" ADD CONSTRAINT "provider_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_service_areas" ADD CONSTRAINT "provider_service_areas_provider_id_service_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."service_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_service_areas" ADD CONSTRAINT "provider_service_areas_locality_id_localities_id_fk" FOREIGN KEY ("locality_id") REFERENCES "public"."localities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_services" ADD CONSTRAINT "provider_services_provider_id_service_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."service_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_services" ADD CONSTRAINT "provider_services_category_id_service_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."service_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_verification_records" ADD CONSTRAINT "provider_verification_records_provider_id_service_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."service_providers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_verification_records" ADD CONSTRAINT "provider_verification_records_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_providers" ADD CONSTRAINT "service_providers_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_providers" ADD CONSTRAINT "service_providers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request_events" ADD CONSTRAINT "service_request_events_request_id_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request_events" ADD CONSTRAINT "service_request_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_on_behalf_of_user_id_users_id_fk" FOREIGN KEY ("on_behalf_of_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_provider_id_service_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."service_providers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_provider_service_id_provider_services_id_fk" FOREIGN KEY ("provider_service_id") REFERENCES "public"."provider_services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_category_id_service_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."service_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_locality_id_localities_id_fk" FOREIGN KEY ("locality_id") REFERENCES "public"."localities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_inventory_item_id_home_inventory_items_id_fk" FOREIGN KEY ("inventory_item_id") REFERENCES "public"."home_inventory_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_consumer_case_id_consumer_cases_id_fk" FOREIGN KEY ("consumer_case_id") REFERENCES "public"."consumer_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_eval_runs" ADD CONSTRAINT "ai_eval_runs_started_by_users_id_fk" FOREIGN KEY ("started_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_feedback" ADD CONSTRAINT "ai_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_source_id_knowledge_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_article_id_knowledge_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."knowledge_articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "locality_uq" ON "localities" USING btree ("name","city","state","country");--> statement-breakpoint
CREATE INDEX "locality_city_idx" ON "localities" USING btree ("city");--> statement-breakpoint
CREATE INDEX "mfa_user_idx" ON "auth"."mfa_factors" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "otp_dest_idx" ON "auth"."otp_challenges" USING btree ("destination_hash","created_at");--> statement-breakpoint
CREATE INDEX "recovery_user_idx" ON "auth"."recovery_codes" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_refresh_uq" ON "auth"."sessions" USING btree ("refresh_token_hash");--> statement-breakpoint
CREATE INDEX "sessions_prev_idx" ON "auth"."sessions" USING btree ("previous_token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "auth"."sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_role_active_uq" ON "staff_roles" USING btree ("user_id","role") WHERE "staff_roles"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_uq" ON "users" USING btree ("phone_e164") WHERE "users"."phone_e164" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email") WHERE "users"."email" is not null;--> statement-breakpoint
CREATE INDEX "users_status_idx" ON "users" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "attachments_key_uq" ON "attachments" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "attachments_owner_idx" ON "attachments" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "attachments_expiry_idx" ON "attachments" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "audit_actor_idx" ON "audit_events" USING btree ("actor_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_subject_idx" ON "audit_events" USING btree ("subject_user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_target_idx" ON "audit_events" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_action_idx" ON "audit_events" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "consent_user_idx" ON "consent_records" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE UNIQUE INDEX "consent_active_uq" ON "consent_records" USING btree ("user_id","purpose") WHERE "consent_records"."withdrawn_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "idem_uq" ON "idempotency_keys" USING btree ("user_id","key");--> statement-breakpoint
CREATE INDEX "idem_expiry_idx" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "device_token_uq" ON "notification_devices" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "device_user_idx" ON "notification_devices" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notif_job_user_idx" ON "notification_jobs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "notif_job_related_idx" ON "notification_jobs" USING btree ("related_type","related_id");--> statement-breakpoint
CREATE INDEX "notif_job_provider_idx" ON "notification_jobs" USING btree ("provider","provider_message_id");--> statement-breakpoint
CREATE INDEX "notif_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "privacy_req_user_idx" ON "privacy_requests" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "privacy_req_status_idx" ON "privacy_requests" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "subs_subject_idx" ON "subscriptions" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE INDEX "cal_owner_idx" ON "calendar_events" USING btree ("owner_user_id","starts_at");--> statement-breakpoint
CREATE INDEX "cal_hh_idx" ON "calendar_events" USING btree ("household_id","starts_at");--> statement-breakpoint
CREATE INDEX "attendee_user_idx" ON "event_attendees" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "announce_hh_idx" ON "family_announcements" USING btree ("household_id","created_at");--> statement-breakpoint
CREATE INDEX "inv_owner_idx" ON "home_inventory_items" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "inv_hh_idx" ON "home_inventory_items" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "budget_owner_idx" ON "household_budgets" USING btree ("owner_user_id","month");--> statement-breakpoint
CREATE INDEX "budget_hh_idx" ON "household_budgets" USING btree ("household_id","month");--> statement-breakpoint
CREATE UNIQUE INDEX "hh_invite_token_uq" ON "household_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "hh_invite_hh_idx" ON "household_invitations" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "hh_member_user_idx" ON "household_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "maint_rec_item_idx" ON "maintenance_records" USING btree ("item_id","performed_on");--> statement-breakpoint
CREATE INDEX "maint_sched_due_idx" ON "maintenance_schedules" USING btree ("active","next_due_on");--> statement-breakpoint
CREATE INDEX "reminder_user_idx" ON "reminders" USING btree ("user_id","fire_at");--> statement-breakpoint
CREATE INDEX "reminder_due_idx" ON "reminders" USING btree ("status","fire_at");--> statement-breakpoint
CREATE INDEX "list_item_list_idx" ON "shopping_list_items" USING btree ("list_id","position");--> statement-breakpoint
CREATE INDEX "list_owner_idx" ON "shopping_lists" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "list_hh_idx" ON "shopping_lists" USING btree ("household_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_assign_uq" ON "task_assignments" USING btree ("task_id","assignee_user_id");--> statement-breakpoint
CREATE INDEX "task_assign_user_idx" ON "task_assignments" USING btree ("assignee_user_id");--> statement-breakpoint
CREATE INDEX "task_cat_owner_idx" ON "task_categories" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "task_cat_hh_idx" ON "task_categories" USING btree ("household_id");--> statement-breakpoint
CREATE INDEX "tasks_owner_idx" ON "tasks" USING btree ("owner_user_id","status","due_at");--> statement-breakpoint
CREATE INDEX "tasks_hh_idx" ON "tasks" USING btree ("household_id","status","due_at");--> statement-breakpoint
CREATE INDEX "tasks_series_idx" ON "tasks" USING btree ("series_id");--> statement-breakpoint
CREATE UNIQUE INDEX "grant_live_uq" ON "access_grants" USING btree ("grantor_id","grantee_id","scope") WHERE "access_grants"."status" in ('pending_cooloff','active');--> statement-breakpoint
CREATE INDEX "grant_grantee_idx" ON "access_grants" USING btree ("grantee_id","scope","status");--> statement-breakpoint
CREATE INDEX "grant_pending_idx" ON "access_grants" USING btree ("status","effective_at");--> statement-breakpoint
CREATE INDEX "alert_delivery_alert_idx" ON "alert_deliveries" USING btree ("alert_type","alert_id");--> statement-breakpoint
CREATE UNIQUE INDEX "checkin_event_uq" ON "check_in_events" USING btree ("schedule_id","due_at");--> statement-breakpoint
CREATE INDEX "checkin_event_user_idx" ON "check_in_events" USING btree ("user_id","due_at");--> statement-breakpoint
CREATE INDEX "checkin_event_state_idx" ON "check_in_events" USING btree ("state","due_at");--> statement-breakpoint
CREATE INDEX "checkin_sched_user_idx" ON "check_in_schedules" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "checkin_sched_due_idx" ON "check_in_schedules" USING btree ("active","next_due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_invite_token_uq" ON "contact_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "contact_invite_inviter_idx" ON "contact_invitations" USING btree ("inviter_user_id","status");--> statement-breakpoint
CREATE INDEX "contact_invite_invitee_idx" ON "contact_invitations" USING btree ("invitee_user_id","status");--> statement-breakpoint
CREATE INDEX "help_recipient_idx" ON "help_request_recipients" USING btree ("recipient_user_id");--> statement-breakpoint
CREATE INDEX "help_user_idx" ON "help_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "help_loc_expiry_idx" ON "help_requests" USING btree ("location_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "trusted_contact_uq" ON "trusted_contacts" USING btree ("user_id","contact_user_id") WHERE "trusted_contacts"."removed_at" is null;--> statement-breakpoint
CREATE INDEX "trusted_contact_contact_idx" ON "trusted_contacts" USING btree ("contact_user_id");--> statement-breakpoint
CREATE INDEX "draft_case_idx" ON "complaint_drafts" USING btree ("case_id");--> statement-breakpoint
CREATE INDEX "case_event_case_idx" ON "consumer_case_events" USING btree ("case_id","occurred_on");--> statement-breakpoint
CREATE INDEX "case_owner_idx" ON "consumer_cases" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE INDEX "case_followup_idx" ON "consumer_cases" USING btree ("next_follow_up_on");--> statement-breakpoint
CREATE INDEX "official_channel_kind_idx" ON "official_channels" USING btree ("kind","active");--> statement-breakpoint
CREATE INDEX "purchase_owner_idx" ON "purchases" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "purchase_warranty_idx" ON "purchases" USING btree ("warranty_expires_on");--> statement-breakpoint
CREATE INDEX "civic_reporter_idx" ON "civic_issues" USING btree ("reporter_id","created_at");--> statement-breakpoint
CREATE INDEX "civic_locality_idx" ON "civic_issues" USING btree ("locality_id","status");--> statement-breakpoint
CREATE INDEX "comments_post_idx" ON "comments" USING btree ("post_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "group_slug_uq" ON "community_groups" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "group_locality_idx" ON "community_groups" USING btree ("locality_id","visibility","status");--> statement-breakpoint
CREATE INDEX "group_name_trgm" ON "community_groups" USING gin ("name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "report_queue_idx" ON "content_reports" USING btree ("status","priority","created_at");--> statement-breakpoint
CREATE INDEX "report_target_idx" ON "content_reports" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_once_uq" ON "content_reports" USING btree ("reporter_id","target_type","target_id") WHERE "content_reports"."status" in ('open','in_review');--> statement-breakpoint
CREATE INDEX "snapshot_retain_idx" ON "content_snapshots" USING btree ("retain_until");--> statement-breakpoint
CREATE UNIQUE INDEX "group_invite_token_uq" ON "group_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "group_invite_group_idx" ON "group_invitations" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "membership_user_idx" ON "group_memberships" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "mod_action_target_idx" ON "moderation_actions" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "mod_action_user_idx" ON "moderation_actions" USING btree ("target_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "appeal_once_uq" ON "moderation_appeals" USING btree ("action_id","appellant_id");--> statement-breakpoint
CREATE INDEX "appeal_status_idx" ON "moderation_appeals" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "posts_group_idx" ON "posts" USING btree ("group_id","status","created_at");--> statement-breakpoint
CREATE INDEX "posts_author_idx" ON "posts" USING btree ("author_id","created_at");--> statement-breakpoint
CREATE INDEX "block_blocked_idx" ON "user_blocks" USING btree ("blocked_id");--> statement-breakpoint
CREATE INDEX "sanction_user_idx" ON "user_sanctions" USING btree ("user_id","kind");--> statement-breakpoint
CREATE INDEX "provider_member_user_idx" ON "provider_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "review_request_uq" ON "provider_reviews" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "review_provider_idx" ON "provider_reviews" USING btree ("provider_id","status");--> statement-breakpoint
CREATE INDEX "provider_area_locality_idx" ON "provider_service_areas" USING btree ("locality_id");--> statement-breakpoint
CREATE INDEX "provider_service_cat_idx" ON "provider_services" USING btree ("category_id","active");--> statement-breakpoint
CREATE INDEX "provider_service_provider_idx" ON "provider_services" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "verif_provider_idx" ON "provider_verification_records" USING btree ("provider_id","check_type");--> statement-breakpoint
CREATE UNIQUE INDEX "svc_cat_slug_uq" ON "service_categories" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "provider_status_idx" ON "service_providers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "provider_name_trgm" ON "service_providers" USING gin ("display_name" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "svc_req_event_idx" ON "service_request_events" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX "svc_req_requester_idx" ON "service_requests" USING btree ("requester_id","created_at");--> statement-breakpoint
CREATE INDEX "svc_req_provider_idx" ON "service_requests" USING btree ("provider_id","status");--> statement-breakpoint
CREATE INDEX "ai_conv_user_idx" ON "ai_conversations" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_conv_expiry_idx" ON "ai_conversations" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "ai_feedback_created_idx" ON "ai_feedback" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_msg_conv_idx" ON "ai_messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ka_slug_uq" ON "knowledge_articles" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "ka_topic_idx" ON "knowledge_articles" USING btree ("topic","status");--> statement-breakpoint
CREATE INDEX "ka_search_idx" ON "knowledge_articles" USING gin ("search_vector");--> statement-breakpoint
CREATE UNIQUE INDEX "kc_article_ord_uq" ON "knowledge_chunks" USING btree ("article_id","ordinal");--> statement-breakpoint
CREATE INDEX "kc_search_idx" ON "knowledge_chunks" USING gin ("search_vector");--> statement-breakpoint
CREATE UNIQUE INDEX "ks_url_uq" ON "knowledge_sources" USING btree ("url") WHERE "knowledge_sources"."url" is not null;