import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgSchema,
  pgTable,
  primaryKey,
  text,
  time,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, id, ts, updatedAt } from './_columns';
import {
  lockScreenDetail,
  notificationCategory,
  otpChannel,
  otpPurpose,
  staffRole,
  themePreference,
  userStatus,
} from './enums';

const citext = customType<{ data: string }>({ dataType: () => 'citext' });

/**
 * Authentication secrets live in a separate `auth` schema so they can be given
 * tighter database grants than ordinary application tables.
 */
export const authSchema = pgSchema('auth');

// ---------------------------------------------------------------- users
export const users = pgTable(
  'users',
  {
    id: id(),
    phoneE164: varchar('phone_e164', { length: 20 }),
    email: citext('email'),
    phoneVerifiedAt: ts('phone_verified_at'),
    emailVerifiedAt: ts('email_verified_at'),
    status: userStatus('status').notNull().default('active'),
    disabledReason: text('disabled_reason'),
    /** Self-declared 18+ at signup; date of birth is never collected. */
    ageConfirmedAt: ts('age_confirmed_at'),
    lastActiveAt: ts('last_active_at'),
    deletionRequestedAt: ts('deletion_requested_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    uniqueIndex('users_phone_uq').on(t.phoneE164).where(sql`${t.phoneE164} is not null`),
    uniqueIndex('users_email_uq').on(t.email).where(sql`${t.email} is not null`),
    index('users_status_idx').on(t.status),
  ],
);

// ---------------------------------------------------------------- auth.*
export const otpChallenges = authSchema.table(
  'otp_challenges',
  {
    id: id(),
    channel: otpChannel('channel').notNull(),
    purpose: otpPurpose('purpose').notNull(),
    /** HMAC of the normalised destination; the raw phone/email is not kept here. */
    destinationHash: varchar('destination_hash', { length: 64 }).notNull(),
    /** Normalised destination, AES-GCM encrypted; needed to create the account on first login. Purged with the challenge. */
    destinationEnc: text('destination_enc').notNull(),
    /** Existing account the destination belongs to, resolved when the code was requested. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    codeHash: varchar('code_hash', { length: 64 }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    expiresAt: ts('expires_at').notNull(),
    consumedAt: ts('consumed_at'),
    ipHash: varchar('ip_hash', { length: 64 }),
    createdAt: createdAt(),
  },
  (t) => [index('otp_dest_idx').on(t.destinationHash, t.createdAt)],
);

export const sessions = authSchema.table(
  'sessions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    refreshTokenHash: varchar('refresh_token_hash', { length: 64 }).notNull(),
    /** Rotation family: reuse of a rotated token revokes every session in the family. */
    familyId: uuid('family_id').notNull(),
    previousTokenHash: varchar('previous_token_hash', { length: 64 }),
    deviceName: varchar('device_name', { length: 120 }),
    platform: varchar('platform', { length: 20 }),
    userAgent: varchar('user_agent', { length: 300 }),
    ipHash: varchar('ip_hash', { length: 64 }),
    /** Authentication methods used: otp_sms, otp_email, totp, recovery_code. */
    amr: text('amr').array().notNull().default(sql`'{}'::text[]`),
    mfaVerifiedAt: ts('mfa_verified_at'),
    reauthAt: ts('reauth_at'),
    lastUsedAt: ts('last_used_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    revokedReason: varchar('revoked_reason', { length: 60 }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('sessions_refresh_uq').on(t.refreshTokenHash),
    index('sessions_prev_idx').on(t.previousTokenHash),
    index('sessions_user_idx').on(t.userId),
  ],
);

export const mfaFactors = authSchema.table(
  'mfa_factors',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 20 }).notNull().default('totp'),
    /** AES-256-GCM encrypted with ENCRYPTION_KEY. */
    secretEncrypted: text('secret_encrypted').notNull(),
    confirmedAt: ts('confirmed_at'),
    lastUsedStep: integer('last_used_step'),
    createdAt: createdAt(),
  },
  (t) => [index('mfa_user_idx').on(t.userId)],
);

export const recoveryCodes = authSchema.table(
  'recovery_codes',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    codeHash: varchar('code_hash', { length: 64 }).notNull(),
    usedAt: ts('used_at'),
    createdAt: createdAt(),
  },
  (t) => [index('recovery_user_idx').on(t.userId)],
);

// ---------------------------------------------------------------- staff
export const staffRoles = pgTable(
  'staff_roles',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: staffRole('role').notNull(),
    grantedBy: uuid('granted_by').references(() => users.id, { onDelete: 'set null' }),
    grantedAt: createdAt(),
    revokedAt: ts('revoked_at'),
  },
  (t) => [uniqueIndex('staff_role_active_uq').on(t.userId, t.role).where(sql`${t.revokedAt} is null`)],
);

// ---------------------------------------------------------------- localities (approximate location)
export const localities = pgTable(
  'localities',
  {
    id: id(),
    name: varchar('name', { length: 120 }).notNull(),
    city: varchar('city', { length: 80 }).notNull(),
    state: varchar('state', { length: 80 }).notNull(),
    country: varchar('country', { length: 2 }).notNull().default('IN'),
    /** First 3 digits of PIN code; never a full address. */
    pincodePrefix: varchar('pincode_prefix', { length: 3 }),
    /** Centroid rounded to ~1 km (2 decimals). */
    lat: varchar('lat', { length: 12 }),
    lng: varchar('lng', { length: 12 }),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('locality_uq').on(t.name, t.city, t.state, t.country), index('locality_city_idx').on(t.city)],
);

// ---------------------------------------------------------------- profiles & preferences
export const userProfiles = pgTable('user_profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  displayName: varchar('display_name', { length: 80 }).notNull(),
  avatarAttachmentId: uuid('avatar_attachment_id'),
  locale: varchar('locale', { length: 10 }).notNull().default('en-IN'),
  timezone: varchar('timezone', { length: 60 }).notNull().default('Asia/Kolkata'),
  seniorMode: boolean('senior_mode').notNull().default(false),
  /** When false the profile is hidden from community search and member lists of public groups. */
  discoverable: boolean('discoverable').notNull().default(false),
  localityId: uuid('locality_id').references(() => localities.id, { onDelete: 'set null' }),
  bio: varchar('bio', { length: 280 }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type AccessibilitySettings = {
  textScale: number; // 1.0 - 2.0
  highContrast: boolean;
  reduceMotion: boolean;
  voiceNavigation: boolean;
  screenReaderHints: boolean;
  simpleConfirmations: boolean;
};

export type DashboardWidget = { key: string; enabled: boolean; order: number };

export const userPreferences = pgTable('user_preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  theme: themePreference('theme').notNull().default('system'),
  accessibility: jsonb('accessibility')
    .$type<AccessibilitySettings>()
    .notNull()
    .default({
      textScale: 1,
      highContrast: false,
      reduceMotion: false,
      voiceNavigation: false,
      screenReaderHints: false,
      simpleConfirmations: true,
    }),
  dashboardWidgets: jsonb('dashboard_widgets').$type<DashboardWidget[]>().notNull().default([]),
  /** Modules the user has switched off (e.g. community, consumer). */
  disabledFeatures: text('disabled_features').array().notNull().default(sql`'{}'::text[]`),
  lockScreenDetail: lockScreenDetail('lock_screen_detail').notNull().default('generic'),
  quietHoursStart: time('quiet_hours_start'),
  quietHoursEnd: time('quiet_hours_end'),
  aiEnabled: boolean('ai_enabled').notNull().default(true),
  aiStoreHistory: boolean('ai_store_history').notNull().default(false),
  updatedAt: updatedAt(),
});

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    category: notificationCategory('category').notNull(),
    inApp: boolean('in_app').notNull().default(true),
    push: boolean('push').notNull().default(true),
    email: boolean('email').notNull().default(false),
    sms: boolean('sms').notNull().default(false),
    /** Critical categories (help, checkins escalation) bypass quiet hours when true. */
    bypassQuietHours: boolean('bypass_quiet_hours').notNull().default(false),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.category] })],
);
