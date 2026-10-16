import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, id, ts, updatedAt } from './_columns';
import {
  assignmentStatus,
  attendeeStatus,
  calendarEventKind,
  householdRole,
  invitationStatus,
  reminderStatus,
  taskPriority,
  taskStatus,
  taskVisibility,
} from './enums';
import { users } from './identity';
import { attachments } from './platform';

// ---------------------------------------------------------------- households
export const households = pgTable('households', {
  id: id(),
  name: varchar('name', { length: 80 }).notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
});

export const householdMembers = pgTable(
  'household_members',
  {
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: householdRole('role').notNull().default('member'),
    joinedAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.userId] }), index('hh_member_user_idx').on(t.userId)],
);

export const householdInvitations = pgTable(
  'household_invitations',
  {
    id: id(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    inviteeContactHash: varchar('invitee_contact_hash', { length: 64 }),
    inviteeUserId: uuid('invitee_user_id').references(() => users.id, { onDelete: 'cascade' }),
    role: householdRole('role').notNull().default('member'),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    status: invitationStatus('status').notNull().default('pending'),
    expiresAt: ts('expires_at').notNull(),
    respondedAt: ts('responded_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('hh_invite_token_uq').on(t.tokenHash), index('hh_invite_hh_idx').on(t.householdId)],
);

export const familyAnnouncements = pgTable(
  'family_announcements',
  {
    id: id(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    body: varchar('body', { length: 1000 }).notNull(),
    pinned: boolean('pinned').notNull().default(false),
    expiresAt: ts('expires_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('announce_hh_idx').on(t.householdId, t.createdAt)],
);

// ---------------------------------------------------------------- tasks
export const taskCategories = pgTable(
  'task_categories',
  {
    id: id(),
    ownerUserId: uuid('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
    householdId: uuid('household_id').references(() => households.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 40 }).notNull(),
    color: varchar('color', { length: 9 }),
    createdAt: createdAt(),
  },
  (t) => [
    check('task_cat_owner_ck', sql`(${t.ownerUserId} is not null) <> (${t.householdId} is not null)`),
    index('task_cat_owner_idx').on(t.ownerUserId),
    index('task_cat_hh_idx').on(t.householdId),
  ],
);

export const tasks = pgTable(
  'tasks',
  {
    id: id(),
    /** Personal tasks: owner set, household null. Chores/household tasks: household set. */
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    householdId: uuid('household_id').references(() => households.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 200 }).notNull(),
    notes: text('notes'),
    categoryId: uuid('category_id').references(() => taskCategories.id, { onDelete: 'set null' }),
    priority: taskPriority('priority').notNull().default('normal'),
    status: taskStatus('status').notNull().default('pending'),
    visibility: taskVisibility('visibility').notNull().default('private'),
    dueAt: ts('due_at'),
    allDay: boolean('all_day').notNull().default(false),
    /** RFC 5545 RRULE, e.g. FREQ=WEEKLY;BYDAY=MO,TH */
    recurrenceRule: varchar('recurrence_rule', { length: 300 }),
    /** For recurring series: each occurrence is materialised as its own row pointing at the series root. */
    seriesId: uuid('series_id'),
    isChore: boolean('is_chore').notNull().default(false),
    completedAt: ts('completed_at'),
    completedBy: uuid('completed_by').references(() => users.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    index('tasks_owner_idx').on(t.ownerUserId, t.status, t.dueAt),
    index('tasks_hh_idx').on(t.householdId, t.status, t.dueAt),
    index('tasks_series_idx').on(t.seriesId),
  ],
);

export const taskAssignments = pgTable(
  'task_assignments',
  {
    id: id(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    assigneeUserId: uuid('assignee_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    assignedBy: uuid('assigned_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: assignmentStatus('status').notNull().default('proposed'),
    respondedAt: ts('responded_at'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('task_assign_uq').on(t.taskId, t.assigneeUserId), index('task_assign_user_idx').on(t.assigneeUserId)],
);

export const taskAttachments = pgTable(
  'task_attachments',
  {
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    attachmentId: uuid('attachment_id')
      .notNull()
      .references(() => attachments.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.attachmentId] })],
);

// ---------------------------------------------------------------- calendar & visits
export const calendarEvents = pgTable(
  'calendar_events',
  {
    id: id(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    householdId: uuid('household_id').references(() => households.id, { onDelete: 'cascade' }),
    kind: calendarEventKind('kind').notNull().default('other'),
    title: varchar('title', { length: 200 }).notNull(),
    description: text('description'),
    startsAt: ts('starts_at').notNull(),
    endsAt: ts('ends_at'),
    allDay: boolean('all_day').notNull().default(false),
    /** Free text such as "Clinic, Sector 12". Not a home address. */
    locationText: varchar('location_text', { length: 200 }),
    recurrenceRule: varchar('recurrence_rule', { length: 300 }),
    visibility: taskVisibility('visibility').notNull().default('private'),
    /** For visits: the person being visited (usually the owner). */
    visitForUserId: uuid('visit_for_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    cancelledAt: ts('cancelled_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('cal_owner_idx').on(t.ownerUserId, t.startsAt),
    index('cal_hh_idx').on(t.householdId, t.startsAt),
  ],
);

export const eventAttendees = pgTable(
  'event_attendees',
  {
    eventId: uuid('event_id')
      .notNull()
      .references(() => calendarEvents.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: attendeeStatus('status').notNull().default('invited'),
    respondedAt: ts('responded_at'),
  },
  (t) => [primaryKey({ columns: [t.eventId, t.userId] }), index('attendee_user_idx').on(t.userId)],
);

// ---------------------------------------------------------------- reminders
export const reminders = pgTable(
  'reminders',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
    eventId: uuid('event_id').references(() => calendarEvents.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 200 }).notNull(),
    fireAt: ts('fire_at').notNull(),
    /** Channels requested; actual delivery respects notification preferences and quiet hours. */
    channels: text('channels').array().notNull().default(sql`'{in_app,push}'::text[]`),
    status: reminderStatus('status').notNull().default('scheduled'),
    jobId: varchar('job_id', { length: 64 }),
    sentAt: ts('sent_at'),
    lastError: varchar('last_error', { length: 300 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('reminder_user_idx').on(t.userId, t.fireAt), index('reminder_due_idx').on(t.status, t.fireAt)],
);

// ---------------------------------------------------------------- shopping lists
export const shoppingLists = pgTable(
  'shopping_lists',
  {
    id: id(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    householdId: uuid('household_id').references(() => households.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 80 }).notNull(),
    archivedAt: ts('archived_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('list_owner_idx').on(t.ownerUserId), index('list_hh_idx').on(t.householdId)],
);

export const shoppingListItems = pgTable(
  'shopping_list_items',
  {
    id: id(),
    listId: uuid('list_id')
      .notNull()
      .references(() => shoppingLists.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    quantity: numeric('quantity', { precision: 10, scale: 2 }),
    unit: varchar('unit', { length: 20 }),
    category: varchar('category', { length: 40 }),
    assignedTo: uuid('assigned_to').references(() => users.id, { onDelete: 'set null' }),
    position: integer('position').notNull().default(0),
    doneAt: ts('done_at'),
    doneBy: uuid('done_by').references(() => users.id, { onDelete: 'set null' }),
    addedBy: uuid('added_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('list_item_list_idx').on(t.listId, t.position)],
);

// ---------------------------------------------------------------- home inventory & maintenance
export const homeInventoryItems = pgTable(
  'home_inventory_items',
  {
    id: id(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    householdId: uuid('household_id').references(() => households.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    category: varchar('category', { length: 40 }).notNull(),
    brand: varchar('brand', { length: 60 }),
    model: varchar('model', { length: 80 }),
    roomOrLocation: varchar('room_or_location', { length: 60 }),
    installedOn: date('installed_on'),
    purchaseDate: date('purchase_date'),
    warrantyExpiresOn: date('warranty_expires_on'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index('inv_owner_idx').on(t.ownerUserId), index('inv_hh_idx').on(t.householdId)],
);

export const maintenanceSchedules = pgTable(
  'maintenance_schedules',
  {
    id: id(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => homeInventoryItems.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 120 }).notNull(),
    intervalDays: integer('interval_days').notNull(),
    nextDueOn: date('next_due_on').notNull(),
    reminderLeadDays: integer('reminder_lead_days').notNull().default(3),
    active: boolean('active').notNull().default(true),
    lastReminderFor: date('last_reminder_for'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('maint_sched_due_idx').on(t.active, t.nextDueOn)],
);

export const maintenanceRecords = pgTable(
  'maintenance_records',
  {
    id: id(),
    itemId: uuid('item_id')
      .notNull()
      .references(() => homeInventoryItems.id, { onDelete: 'cascade' }),
    scheduleId: uuid('schedule_id').references(() => maintenanceSchedules.id, { onDelete: 'set null' }),
    performedOn: date('performed_on').notNull(),
    description: varchar('description', { length: 500 }).notNull(),
    providerName: varchar('provider_name', { length: 120 }),
    providerId: uuid('provider_id'),
    serviceRequestId: uuid('service_request_id'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [index('maint_rec_item_idx').on(t.itemId, t.performedOn)],
);

// ---------------------------------------------------------------- high-level household budget (optional, manual)
export const householdBudgets = pgTable(
  'household_budgets',
  {
    id: id(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    householdId: uuid('household_id').references(() => households.id, { onDelete: 'cascade' }),
    /** First day of month, e.g. 2026-10-01 */
    month: date('month').notNull(),
    category: varchar('category', { length: 40 }).notNull(),
    plannedAmount: numeric('planned_amount', { precision: 12, scale: 2 }).notNull(),
    spentAmount: numeric('spent_amount', { precision: 12, scale: 2 }).notNull().default('0'),
    currency: varchar('currency', { length: 3 }).notNull().default('INR'),
    note: varchar('note', { length: 200 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('budget_owner_idx').on(t.ownerUserId, t.month), index('budget_hh_idx').on(t.householdId, t.month)],
);
