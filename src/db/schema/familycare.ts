import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, id, ts, updatedAt } from './_columns';
import {
  careSuggestionStatus,
  checkInEventState,
  checkInKind,
  grantScope,
  grantStatus,
  helpRequestKind,
  helpRequestStatus,
  invitationStatus,
} from './enums';
import { users } from './identity';
import { notificationJobs } from './platform';

// ---------------------------------------------------------------- trusted contacts
export const contactInvitations = pgTable(
  'contact_invitations',
  {
    id: id(),
    inviterUserId: uuid('inviter_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** HMAC of invitee phone/email; raw value is only used to send the invite. */
    inviteeContactHash: varchar('invitee_contact_hash', { length: 64 }),
    inviteeUserId: uuid('invitee_user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** Scopes the inviter offers to grant the invitee once accepted (still subject to cooling-off). */
    proposedScopes: text('proposed_scopes').array().notNull().default(sql`'{}'::text[]`),
    /** Scopes the inviter asks the invitee to share back (e.g. a son asking his mother to share check-ins). The invitee chooses on accepting. */
    requestedScopes: text('requested_scopes').array().notNull().default(sql`'{}'::text[]`),
    label: varchar('label', { length: 40 }),
    message: varchar('message', { length: 300 }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    status: invitationStatus('status').notNull().default('pending'),
    expiresAt: ts('expires_at').notNull(),
    respondedAt: ts('responded_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('contact_invite_token_uq').on(t.tokenHash),
    index('contact_invite_inviter_idx').on(t.inviterUserId, t.status),
    index('contact_invite_invitee_idx').on(t.inviteeUserId, t.status),
  ],
);

/** A two-way acknowledged relationship. Holds no access by itself — access is only via access_grants. */
export const trustedContacts = pgTable(
  'trusted_contacts',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    contactUserId: uuid('contact_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Optional user-chosen label such as "Neighbour". Relationship type is not collected. */
    label: varchar('label', { length: 40 }),
    createdAt: createdAt(),
    removedAt: ts('removed_at'),
  },
  (t) => [
    uniqueIndex('trusted_contact_uq').on(t.userId, t.contactUserId).where(sql`${t.removedAt} is null`),
    index('trusted_contact_contact_idx').on(t.contactUserId),
  ],
);

export const accessGrants = pgTable(
  'access_grants',
  {
    id: id(),
    grantorId: uuid('grantor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    granteeId: uuid('grantee_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scope: grantScope('scope').notNull(),
    status: grantStatus('status').notNull().default('pending_cooloff'),
    /** Grant becomes active at effective_at (cooling-off window against coercion). */
    effectiveAt: ts('effective_at').notNull(),
    expiresAt: ts('expires_at'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    revokedAt: ts('revoked_at'),
    revokedBy: uuid('revoked_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('grant_live_uq')
      .on(t.grantorId, t.granteeId, t.scope)
      .where(sql`${t.status} in ('pending_cooloff','active')`),
    index('grant_grantee_idx').on(t.granteeId, t.scope, t.status),
    index('grant_pending_idx').on(t.status, t.effectiveAt),
  ],
);

// ---------------------------------------------------------------- check-ins
export const checkInSchedules = pgTable(
  'check_in_schedules',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: varchar('label', { length: 80 }).notNull(),
    /** 'wellbeing' = "Are you OK?"; 'medicine' = "Did you take it?". Same reminder and alert rules. */
    purpose: varchar('purpose', { length: 20 }).notNull().default('wellbeing'),
    kind: checkInKind('kind').notNull(),
    /** Local wall-clock time for daily/weekly schedules. */
    timeLocal: time('time_local'),
    /** 0 = Sunday ... 6 = Saturday; used for weekly. */
    daysOfWeek: smallint('days_of_week').array(),
    oneOffAt: ts('one_off_at'),
    timezone: varchar('timezone', { length: 60 }).notNull().default('Asia/Kolkata'),
    /** Minutes after due time to send the user a reminder. */
    reminderAfterMinutes: integer('reminder_after_minutes').notNull().default(15),
    /** Minutes after the reminder before contacts are alerted. */
    graceMinutes: integer('grace_minutes').notNull().default(30),
    escalate: boolean('escalate').notNull().default(true),
    active: boolean('active').notNull().default(true),
    nextDueAt: ts('next_due_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('checkin_sched_user_idx').on(t.userId), index('checkin_sched_due_idx').on(t.active, t.nextDueAt)],
);

export const checkInEscalationContacts = pgTable(
  'check_in_escalation_contacts',
  {
    scheduleId: uuid('schedule_id')
      .notNull()
      .references(() => checkInSchedules.id, { onDelete: 'cascade' }),
    contactUserId: uuid('contact_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    position: smallint('position').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.scheduleId, t.contactUserId] })],
);

/**
 * A caregiver's proposed change to a parent's check-in or medicine schedule. Proposing never changes anything by
 * itself — it only becomes real when the parent (never anyone else) approves it. "kind" is a small, open-ended
 * string rather than a Postgres enum so new proposal kinds don't need a schema migration to add.
 */
export const careSuggestions = pgTable(
  'care_suggestions',
  {
    id: id(),
    targetUserId: uuid('target_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    proposedBy: uuid('proposed_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 40 }).notNull(),
    payload: jsonb('payload').notNull(),
    status: careSuggestionStatus('status').notNull().default('pending'),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decidedAt: ts('decided_at'),
    /** Set when approving created something (e.g. a check-in schedule), so it can be traced or undone. */
    resultScheduleId: uuid('result_schedule_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('care_suggestion_target_idx').on(t.targetUserId, t.status), index('care_suggestion_by_idx').on(t.proposedBy, t.status)],
);

export const checkInEvents = pgTable(
  'check_in_events',
  {
    id: id(),
    scheduleId: uuid('schedule_id')
      .notNull()
      .references(() => checkInSchedules.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    dueAt: ts('due_at').notNull(),
    state: checkInEventState('state').notNull().default('pending'),
    completedAt: ts('completed_at'),
    remindedAt: ts('reminded_at'),
    missedAt: ts('missed_at'),
    escalatedAt: ts('escalated_at'),
    acknowledgedBy: uuid('acknowledged_by').references(() => users.id, { onDelete: 'set null' }),
    acknowledgedAt: ts('acknowledged_at'),
    /** Short optional status note, e.g. "Called her, all fine". */
    note: varchar('note', { length: 200 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('checkin_event_uq').on(t.scheduleId, t.dueAt),
    index('checkin_event_user_idx').on(t.userId, t.dueAt),
    index('checkin_event_state_idx').on(t.state, t.dueAt),
  ],
);

// ---------------------------------------------------------------- one-tap help
export const emergencyContactPreferences = pgTable('emergency_contact_preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** Public emergency number to offer as a call button. 112 is India's integrated emergency number. */
  emergencyNumber: varchar('emergency_number', { length: 15 }).notNull().default('112'),
  /** Contact whose phone the app offers to call first. Must be a trusted contact. */
  primaryCallContactId: uuid('primary_call_contact_id').references(() => users.id, { onDelete: 'set null' }),
  notifyContacts: boolean('notify_contacts').notNull().default(true),
  shareLocationByDefault: boolean('share_location_by_default').notNull().default(false),
  defaultMessage: varchar('default_message', { length: 200 }),
  updatedAt: updatedAt(),
});

export const helpRequests = pgTable(
  'help_requests',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: helpRequestKind('kind').notNull(),
    message: varchar('message', { length: 300 }),
    /** Rounded to 4 decimals (~11 m); purged at location_expires_at. */
    locationLat: varchar('location_lat', { length: 12 }),
    locationLng: varchar('location_lng', { length: 12 }),
    locationExpiresAt: ts('location_expires_at'),
    status: helpRequestStatus('status').notNull().default('open'),
    serviceRequestId: uuid('service_request_id'),
    resolvedAt: ts('resolved_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('help_user_idx').on(t.userId, t.createdAt), index('help_loc_expiry_idx').on(t.locationExpiresAt)],
);

export const helpRequestRecipients = pgTable(
  'help_request_recipients',
  {
    helpRequestId: uuid('help_request_id')
      .notNull()
      .references(() => helpRequests.id, { onDelete: 'cascade' }),
    recipientUserId: uuid('recipient_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    acknowledgedAt: ts('acknowledged_at'),
  },
  (t) => [primaryKey({ columns: [t.helpRequestId, t.recipientUserId] }), index('help_recipient_idx').on(t.recipientUserId)],
);

/** Links each escalation/help alert to the notification jobs that carried it, so delivery status is provable. */
export const alertDeliveries = pgTable(
  'alert_deliveries',
  {
    id: id(),
    alertType: varchar('alert_type', { length: 30 }).notNull(), // check_in_missed | help_request
    alertId: uuid('alert_id').notNull(),
    recipientUserId: uuid('recipient_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    notificationJobId: uuid('notification_job_id').references(() => notificationJobs.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('alert_delivery_alert_idx').on(t.alertType, t.alertId)],
);
