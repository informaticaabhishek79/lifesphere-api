ALTER TABLE "localities" ALTER COLUMN "pincode_prefix" SET DATA TYPE varchar(5);--> statement-breakpoint
ALTER TABLE "user_profiles" ALTER COLUMN "locale" SET DEFAULT 'en';--> statement-breakpoint
ALTER TABLE "user_profiles" ALTER COLUMN "timezone" SET DEFAULT 'UTC';--> statement-breakpoint
ALTER TABLE "user_profiles" ADD COLUMN "country" varchar(2);--> statement-breakpoint
ALTER TABLE "official_channels" ADD COLUMN "country" varchar(2);--> statement-breakpoint
ALTER TABLE "knowledge_articles" ADD COLUMN "country" varchar(2);--> statement-breakpoint
-- Backfill: everything created before country support was Indian.
UPDATE "user_profiles" SET "country" = 'IN' WHERE "country" IS NULL AND ("timezone" IN ('Asia/Kolkata', 'Asia/Calcutta') OR "user_id" IN (SELECT "id" FROM "users" WHERE "phone_e164" LIKE '+91%'));--> statement-breakpoint
UPDATE "official_channels" SET "country" = 'IN' WHERE "country" IS NULL;--> statement-breakpoint
UPDATE "knowledge_articles" SET "country" = 'IN' WHERE "country" IS NULL AND ("title" ILIKE '%india%' OR "body" ILIKE '%india%');
