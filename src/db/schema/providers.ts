import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, primaryKey, smallint, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, id, ts, updatedAt } from './_columns';
import {
  contentStatus,
  providerMemberRole,
  providerStatus,
  providerType,
  serviceRequestStatus,
  verificationCheckType,
  verificationLevel,
  verificationStatus,
} from './enums';
import { localities, users } from './identity';
import { homeInventoryItems } from './lifeos';
import { consumerCases } from './consumer';

export const serviceCategories = pgTable(
  'service_categories',
  {
    id: id(),
    slug: varchar('slug', { length: 60 }).notNull(),
    name: varchar('name', { length: 80 }).notNull(),
    description: varchar('description', { length: 500 }),
    parentId: uuid('parent_id'),
    /** Providers must hold a passed verification before accepting requests in this category. */
    requiresVerification: boolean('requires_verification').notNull().default(false),
    /** Senior-support categories require 'screened' verification (in-home, personal care, companionship). */
    seniorSupport: boolean('senior_support').notNull().default(false),
    active: boolean('active').notNull().default(true),
    sortOrder: smallint('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('svc_cat_slug_uq').on(t.slug)],
);

export const serviceProviders = pgTable(
  'service_providers',
  {
    id: id(),
    displayName: varchar('display_name', { length: 120 }).notNull(),
    providerType: providerType('provider_type').notNull(),
    description: text('description'),
    phonePublic: varchar('phone_public', { length: 20 }),
    emailPublic: varchar('email_public', { length: 160 }),
    websiteUrl: varchar('website_url', { length: 300 }),
    status: providerStatus('status').notNull().default('draft'),
    /** Derived from provider_verification_records by reviewers; never self-declared. */
    verificationLevel: verificationLevel('verification_level').notNull().default('none'),
    /** Paid placement must be disclosed and never shown as verification. */
    isSponsored: boolean('is_sponsored').notNull().default(false),
    sponsoredUntil: ts('sponsored_until'),
    rejectionReason: varchar('rejection_reason', { length: 500 }),
    submittedAt: ts('submitted_at'),
    approvedAt: ts('approved_at'),
    approvedBy: uuid('approved_by').references(() => users.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('provider_status_idx').on(t.status),
    index('provider_name_trgm').using('gin', sql`${t.displayName} gin_trgm_ops`),
  ],
);

export const providerMembers = pgTable(
  'provider_members',
  {
    providerId: uuid('provider_id')
      .notNull()
      .references(() => serviceProviders.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: providerMemberRole('role').notNull().default('staff'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.providerId, t.userId] }), index('provider_member_user_idx').on(t.userId)],
);

export const providerServices = pgTable(
  'provider_services',
  {
    id: id(),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => serviceProviders.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => serviceCategories.id),
    title: varchar('title', { length: 120 }).notNull(),
    description: varchar('description', { length: 1000 }),
    /** Free-text pricing guidance, e.g. "Visit charge ₹300, parts extra". No payments are processed. */
    priceNote: varchar('price_note', { length: 200 }),
    active: boolean('active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('provider_service_cat_idx').on(t.categoryId, t.active), index('provider_service_provider_idx').on(t.providerId)],
);

export const providerServiceAreas = pgTable(
  'provider_service_areas',
  {
    providerId: uuid('provider_id')
      .notNull()
      .references(() => serviceProviders.id, { onDelete: 'cascade' }),
    localityId: uuid('locality_id')
      .notNull()
      .references(() => localities.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.providerId, t.localityId] }), index('provider_area_locality_idx').on(t.localityId)],
);

/** Records of checks performed by staff. Never stores ID numbers or document images. */
export const providerVerificationRecords = pgTable(
  'provider_verification_records',
  {
    id: id(),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => serviceProviders.id, { onDelete: 'cascade' }),
    checkType: verificationCheckType('check_type').notNull(),
    status: verificationStatus('status').notNull().default('pending'),
    /** Partner/agency that performed the check, if outsourced. */
    performedByPartner: varchar('performed_by_partner', { length: 120 }),
    reviewerId: uuid('reviewer_id').references(() => users.id, { onDelete: 'set null' }),
    /** Non-sensitive note, e.g. "Background check report ref BG-2026-118 reviewed". */
    note: varchar('note', { length: 500 }),
    checkedAt: ts('checked_at'),
    expiresAt: ts('expires_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('verif_provider_idx').on(t.providerId, t.checkType)],
);

export const serviceRequests = pgTable(
  'service_requests',
  {
    id: id(),
    requesterId: uuid('requester_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Optional: request placed on behalf of someone who granted it (e.g. adult child for parent). */
    onBehalfOfUserId: uuid('on_behalf_of_user_id').references(() => users.id, { onDelete: 'set null' }),
    providerId: uuid('provider_id').references(() => serviceProviders.id, { onDelete: 'set null' }),
    providerServiceId: uuid('provider_service_id').references(() => providerServices.id, { onDelete: 'set null' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => serviceCategories.id),
    title: varchar('title', { length: 200 }).notNull(),
    description: varchar('description', { length: 2000 }),
    localityId: uuid('locality_id').references(() => localities.id, { onDelete: 'set null' }),
    /** Visit address/landmark: visible to the provider only once the request is accepted. */
    locationNote: varchar('location_note', { length: 300 }),
    preferredStart: ts('preferred_start'),
    preferredEnd: ts('preferred_end'),
    scheduledAt: ts('scheduled_at'),
    status: serviceRequestStatus('status').notNull().default('requested'),
    statusReason: varchar('status_reason', { length: 300 }),
    inventoryItemId: uuid('inventory_item_id').references(() => homeInventoryItems.id, { onDelete: 'set null' }),
    consumerCaseId: uuid('consumer_case_id').references(() => consumerCases.id, { onDelete: 'set null' }),
    completedAt: ts('completed_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('svc_req_requester_idx').on(t.requesterId, t.createdAt),
    index('svc_req_provider_idx').on(t.providerId, t.status),
  ],
);

/** Append-only status history for auditability. */
export const serviceRequestEvents = pgTable(
  'service_request_events',
  {
    id: id(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => serviceRequests.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    fromStatus: serviceRequestStatus('from_status'),
    toStatus: serviceRequestStatus('to_status').notNull(),
    note: varchar('note', { length: 500 }),
    createdAt: createdAt(),
  },
  (t) => [index('svc_req_event_idx').on(t.requestId, t.createdAt)],
);

export const providerReviews = pgTable(
  'provider_reviews',
  {
    id: id(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => serviceRequests.id, { onDelete: 'cascade' }),
    providerId: uuid('provider_id')
      .notNull()
      .references(() => serviceProviders.id, { onDelete: 'cascade' }),
    reviewerId: uuid('reviewer_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rating: smallint('rating').notNull(),
    body: varchar('body', { length: 1000 }),
    status: contentStatus('status').notNull().default('published'),
    providerResponse: varchar('provider_response', { length: 1000 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('review_request_uq').on(t.requestId),
    index('review_provider_idx').on(t.providerId, t.status),
    check('review_rating_ck', sql`${t.rating} between 1 and 5`),
  ],
);
