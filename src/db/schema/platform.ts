import { sql } from 'drizzle-orm';
import { bigint, boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, id, ts, updatedAt } from './_columns';
import {
  actorType,
  attachmentPurpose,
  attachmentStatus,
  devicePlatform,
  notificationCategory,
  notificationChannel,
  notificationJobStatus,
  privacyRequestStatus,
  privacyRequestType,
  subscriptionStatus,
  subscriptionSubject,
} from './enums';
import { users } from './identity';

// ---------------------------------------------------------------- consent
export const consentRecords = pgTable(
  'consent_records',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** e.g. terms, privacy_notice, location_help, checkins_sharing, ai_assistance, marketing_email */
    purpose: varchar('purpose', { length: 60 }).notNull(),
    policyVersion: varchar('policy_version', { length: 20 }).notNull(),
    grantedAt: ts('granted_at').notNull().defaultNow(),
    withdrawnAt: ts('withdrawn_at'),
    source: varchar('source', { length: 30 }).notNull().default('app'),
  },
  (t) => [
    index('consent_user_idx').on(t.userId, t.purpose),
    uniqueIndex('consent_active_uq').on(t.userId, t.purpose).where(sql`${t.withdrawnAt} is null`),
  ],
);

// ---------------------------------------------------------------- privacy requests
export const privacyRequests = pgTable(
  'privacy_requests',
  {
    id: id(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    type: privacyRequestType('type').notNull(),
    status: privacyRequestStatus('status').notNull().default('received'),
    details: text('details'),
    resultAttachmentId: uuid('result_attachment_id'),
    dueAt: ts('due_at').notNull(),
    completedAt: ts('completed_at'),
    handledBy: uuid('handled_by').references(() => users.id, { onDelete: 'set null' }),
    resolutionNote: text('resolution_note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('privacy_req_user_idx').on(t.userId), index('privacy_req_status_idx').on(t.status, t.dueAt)],
);

// ---------------------------------------------------------------- attachments (object storage metadata)
export const attachments = pgTable(
  'attachments',
  {
    id: id(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    purpose: attachmentPurpose('purpose').notNull(),
    storageKey: varchar('storage_key', { length: 300 }).notNull(),
    originalName: varchar('original_name', { length: 200 }),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    status: attachmentStatus('status').notNull().default('ready'),
    /** Temporary files are purged at expires_at. */
    temporary: boolean('temporary').notNull().default(false),
    expiresAt: ts('expires_at'),
    createdAt: createdAt(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [
    uniqueIndex('attachments_key_uq').on(t.storageKey),
    index('attachments_owner_idx').on(t.ownerUserId),
    index('attachments_expiry_idx').on(t.expiresAt),
  ],
);

// ---------------------------------------------------------------- audit (ids and action names only, never content)
export const auditEvents = pgTable(
  'audit_events',
  {
    id: id(),
    actorId: uuid('actor_id'),
    actorType: actorType('actor_type').notNull(),
    action: varchar('action', { length: 80 }).notNull(),
    targetType: varchar('target_type', { length: 40 }),
    targetId: uuid('target_id'),
    /** For grant changes etc.: the user whose data is affected, so they can see their own trail. */
    subjectUserId: uuid('subject_user_id'),
    ipHash: varchar('ip_hash', { length: 64 }),
    metadata: jsonb('metadata').$type<Record<string, string | number | boolean | null>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index('audit_actor_idx').on(t.actorId, t.createdAt),
    index('audit_subject_idx').on(t.subjectUserId, t.createdAt),
    index('audit_target_idx').on(t.targetType, t.targetId),
    index('audit_action_idx').on(t.action, t.createdAt),
  ],
);

// ---------------------------------------------------------------- idempotency
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: id(),
    userId: uuid('user_id').notNull(),
    key: varchar('key', { length: 100 }).notNull(),
    method: varchar('method', { length: 10 }).notNull(),
    path: varchar('path', { length: 300 }).notNull(),
    requestHash: varchar('request_hash', { length: 64 }).notNull(),
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    createdAt: createdAt(),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [uniqueIndex('idem_uq').on(t.userId, t.key), index('idem_expiry_idx').on(t.expiresAt)],
);

// ---------------------------------------------------------------- platform config / feature flags
export const appConfig = pgTable('app_config', {
  key: varchar('key', { length: 80 }).primaryKey(),
  value: jsonb('value').notNull(),
  description: text('description'),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------- plans & entitlements (no payment collection)
export const plans = pgTable('plans', {
  code: varchar('code', { length: 40 }).primaryKey(),
  name: varchar('name', { length: 80 }).notNull(),
  subject: subscriptionSubject('subject').notNull(),
  features: jsonb('features').$type<Record<string, number | boolean>>().notNull().default({}),
  active: boolean('active').notNull().default(true),
  createdAt: createdAt(),
});

export const subscriptions = pgTable(
  'subscriptions',
  {
    id: id(),
    subjectType: subscriptionSubject('subject_type').notNull(),
    subjectId: uuid('subject_id').notNull(),
    planCode: varchar('plan_code', { length: 40 })
      .notNull()
      .references(() => plans.code),
    status: subscriptionStatus('status').notNull().default('active'),
    source: varchar('source', { length: 30 }).notNull().default('manual'),
    startsAt: ts('starts_at').notNull().defaultNow(),
    endsAt: ts('ends_at'),
    createdAt: createdAt(),
  },
  (t) => [index('subs_subject_idx').on(t.subjectType, t.subjectId)],
);

// ---------------------------------------------------------------- notifications
export const notificationDevices = pgTable(
  'notification_devices',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id'),
    platform: devicePlatform('platform').notNull(),
    /** FCM registration token, or JSON-serialised Web Push subscription. */
    token: text('token').notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    label: varchar('label', { length: 80 }),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('device_token_uq').on(t.tokenHash), index('device_user_idx').on(t.userId)],
);

/** In-app inbox. */
export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    category: notificationCategory('category').notNull(),
    title: varchar('title', { length: 160 }).notNull(),
    body: varchar('body', { length: 500 }),
    /** Deep link target, e.g. { type: 'check_in_event', id }. Never content. */
    data: jsonb('data').$type<Record<string, string>>().notNull().default({}),
    readAt: ts('read_at'),
    createdAt: createdAt(),
  },
  (t) => [index('notif_user_idx').on(t.userId, t.createdAt)],
);

/** Outbound delivery attempts per channel, with provider-confirmed status. */
export const notificationJobs = pgTable(
  'notification_jobs',
  {
    id: id(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    category: notificationCategory('category').notNull(),
    channel: notificationChannel('channel').notNull(),
    template: varchar('template', { length: 60 }).notNull(),
    status: notificationJobStatus('status').notNull().default('queued'),
    provider: varchar('provider', { length: 30 }),
    providerMessageId: varchar('provider_message_id', { length: 120 }),
    attempts: integer('attempts').notNull().default(0),
    lastError: varchar('last_error', { length: 300 }),
    scheduledFor: ts('scheduled_for').notNull().defaultNow(),
    sentAt: ts('sent_at'),
    deliveredAt: ts('delivered_at'),
    relatedType: varchar('related_type', { length: 40 }),
    relatedId: uuid('related_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('notif_job_user_idx').on(t.userId, t.createdAt),
    index('notif_job_related_idx').on(t.relatedType, t.relatedId),
    index('notif_job_provider_idx').on(t.provider, t.providerMessageId),
  ],
);
