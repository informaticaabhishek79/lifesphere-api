import { sql } from 'drizzle-orm';
import { index, integer, jsonb, pgTable, primaryKey, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, id, ts, updatedAt } from './_columns';
import {
  appealStatus,
  civicCategory,
  civicStatus,
  contentStatus,
  groupRole,
  groupStatus,
  groupVisibility,
  invitationStatus,
  membershipStatus,
  moderationActionKind,
  postKind,
  postingPolicy,
  reactionKind,
  reportReason,
  reportStatus,
  reportTargetType,
  sanctionKind,
} from './enums';
import { localities, users } from './identity';
import { officialChannels } from './consumer';
import { attachments } from './platform';

// ---------------------------------------------------------------- groups
export const communityGroups = pgTable(
  'community_groups',
  {
    id: id(),
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 120 }).notNull(),
    description: varchar('description', { length: 1000 }),
    visibility: groupVisibility('visibility').notNull().default('private'),
    category: varchar('category', { length: 40 }),
    localityId: uuid('locality_id').references(() => localities.id, { onDelete: 'set null' }),
    postingPolicy: postingPolicy('posting_policy').notNull().default('all_members'),
    status: groupStatus('status').notNull().default('active'),
    rules: text('rules'),
    memberCount: integer('member_count').notNull().default(0),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('group_slug_uq').on(t.slug),
    index('group_locality_idx').on(t.localityId, t.visibility, t.status),
    index('group_name_trgm').using('gin', sql`${t.name} gin_trgm_ops`),
  ],
);

export const groupMemberships = pgTable(
  'group_memberships',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => communityGroups.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: groupRole('role').notNull().default('member'),
    status: membershipStatus('status').notNull().default('active'),
    joinedAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] }), index('membership_user_idx').on(t.userId, t.status)],
);

export const groupInvitations = pgTable(
  'group_invitations',
  {
    id: id(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => communityGroups.id, { onDelete: 'cascade' }),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    inviteeUserId: uuid('invitee_user_id').references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    status: invitationStatus('status').notNull().default('pending'),
    expiresAt: ts('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('group_invite_token_uq').on(t.tokenHash), index('group_invite_group_idx').on(t.groupId)],
);

// ---------------------------------------------------------------- posts, comments, reactions
export const posts = pgTable(
  'posts',
  {
    id: id(),
    groupId: uuid('group_id')
      .notNull()
      .references(() => communityGroups.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: postKind('kind').notNull().default('text'),
    title: varchar('title', { length: 200 }),
    body: text('body').notNull(),
    eventStartsAt: ts('event_starts_at'),
    eventEndsAt: ts('event_ends_at'),
    /** Approximate place such as "Community hall"; never a home address. */
    eventLocationText: varchar('event_location_text', { length: 200 }),
    status: contentStatus('status').notNull().default('published'),
    removedReason: varchar('removed_reason', { length: 200 }),
    commentCount: integer('comment_count').notNull().default(0),
    reactionCount: integer('reaction_count').notNull().default(0),
    pinnedAt: ts('pinned_at'),
    editedAt: ts('edited_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('posts_group_idx').on(t.groupId, t.status, t.createdAt),
    index('posts_author_idx').on(t.authorId, t.createdAt),
  ],
);

export const postAttachments = pgTable(
  'post_attachments',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    attachmentId: uuid('attachment_id')
      .notNull()
      .references(() => attachments.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.postId, t.attachmentId] })],
);

export const comments = pgTable(
  'comments',
  {
    id: id(),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    parentCommentId: uuid('parent_comment_id'),
    body: varchar('body', { length: 2000 }).notNull(),
    status: contentStatus('status').notNull().default('published'),
    editedAt: ts('edited_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('comments_post_idx').on(t.postId, t.createdAt)],
);

export const reactions = pgTable(
  'reactions',
  {
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: reactionKind('kind').notNull().default('like'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId] })],
);

export const bookmarks = pgTable(
  'bookmarks',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    postId: uuid('post_id')
      .notNull()
      .references(() => posts.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.postId] })],
);

export const userBlocks = pgTable(
  'user_blocks',
  {
    blockerId: uuid('blocker_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    blockedId: uuid('blocked_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] }), index('block_blocked_idx').on(t.blockedId)],
);

// ---------------------------------------------------------------- civic issues
export const civicIssues = pgTable(
  'civic_issues',
  {
    id: id(),
    reporterId: uuid('reporter_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    localityId: uuid('locality_id').references(() => localities.id, { onDelete: 'set null' }),
    category: civicCategory('category').notNull(),
    description: varchar('description', { length: 1000 }).notNull(),
    /** Landmark-level text, e.g. "Near gate 2 of the park". */
    locationText: varchar('location_text', { length: 200 }),
    status: civicStatus('status').notNull().default('draft'),
    officialChannelId: uuid('official_channel_id').references(() => officialChannels.id, { onDelete: 'set null' }),
    /** Exactly as entered by the user after submitting on the official channel. */
    externalReference: varchar('external_reference', { length: 80 }),
    reportedAt: ts('reported_at'),
    /** Optional: shared to a locality group as a civic_info post. */
    postId: uuid('post_id').references(() => posts.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('civic_reporter_idx').on(t.reporterId, t.createdAt),
    index('civic_locality_idx').on(t.localityId, t.status),
  ],
);

// ---------------------------------------------------------------- moderation
export const contentReports = pgTable(
  'content_reports',
  {
    id: id(),
    /** Null for automatic reports raised by the spam/abuse filters. */
    reporterId: uuid('reporter_id').references(() => users.id, { onDelete: 'set null' }),
    source: varchar('source', { length: 20 }).notNull().default('user'),
    targetType: reportTargetType('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    /** The user responsible for the reported content (author/owner), for repeat-offender tracking. */
    targetUserId: uuid('target_user_id').references(() => users.id, { onDelete: 'set null' }),
    groupId: uuid('group_id').references(() => communityGroups.id, { onDelete: 'set null' }),
    reason: reportReason('reason').notNull(),
    details: varchar('details', { length: 1000 }),
    status: reportStatus('status').notNull().default('open'),
    priority: integer('priority').notNull().default(0),
    assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
    resolvedAt: ts('resolved_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('report_queue_idx').on(t.status, t.priority, t.createdAt),
    index('report_target_idx').on(t.targetType, t.targetId),
    uniqueIndex('report_once_uq').on(t.reporterId, t.targetType, t.targetId).where(sql`${t.status} in ('open','in_review')`),
  ],
);

/** Evidence preserved at report time so later edits/deletes don't destroy it. Purged at retain_until. */
export const contentSnapshots = pgTable(
  'content_snapshots',
  {
    id: id(),
    reportId: uuid('report_id')
      .notNull()
      .references(() => contentReports.id, { onDelete: 'cascade' }),
    targetType: reportTargetType('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    snapshot: jsonb('snapshot').notNull(),
    retainUntil: ts('retain_until').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('snapshot_retain_idx').on(t.retainUntil)],
);

export const moderationActions = pgTable(
  'moderation_actions',
  {
    id: id(),
    reportId: uuid('report_id').references(() => contentReports.id, { onDelete: 'set null' }),
    moderatorId: uuid('moderator_id').references(() => users.id, { onDelete: 'set null' }),
    targetType: reportTargetType('target_type').notNull(),
    targetId: uuid('target_id').notNull(),
    targetUserId: uuid('target_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: moderationActionKind('action').notNull(),
    reason: varchar('reason', { length: 500 }).notNull(),
    /** Group-level moderation by group admins vs platform moderation by staff. */
    scope: varchar('scope', { length: 10 }).notNull().default('platform'),
    expiresAt: ts('expires_at'),
    createdAt: createdAt(),
  },
  (t) => [index('mod_action_target_idx').on(t.targetType, t.targetId), index('mod_action_user_idx').on(t.targetUserId)],
);

export const moderationAppeals = pgTable(
  'moderation_appeals',
  {
    id: id(),
    actionId: uuid('action_id')
      .notNull()
      .references(() => moderationActions.id, { onDelete: 'cascade' }),
    appellantId: uuid('appellant_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    statement: varchar('statement', { length: 2000 }).notNull(),
    status: appealStatus('status').notNull().default('open'),
    decidedBy: uuid('decided_by').references(() => users.id, { onDelete: 'set null' }),
    decisionNote: varchar('decision_note', { length: 1000 }),
    decidedAt: ts('decided_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('appeal_once_uq').on(t.actionId, t.appellantId), index('appeal_status_idx').on(t.status, t.createdAt)],
);

export const userSanctions = pgTable(
  'user_sanctions',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: sanctionKind('kind').notNull(),
    reason: varchar('reason', { length: 500 }).notNull(),
    actionId: uuid('action_id').references(() => moderationActions.id, { onDelete: 'set null' }),
    startsAt: ts('starts_at').notNull().defaultNow(),
    endsAt: ts('ends_at'),
    liftedAt: ts('lifted_at'),
    liftedBy: uuid('lifted_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [index('sanction_user_idx').on(t.userId, t.kind)],
);
