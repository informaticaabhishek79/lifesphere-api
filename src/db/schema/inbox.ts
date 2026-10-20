import { boolean, index, integer, jsonb, pgEnum, pgTable, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { createdAt, id, ts, updatedAt } from './_columns';
import { docFiles, docFolders } from './agents';
import { users } from './identity';
import { households } from './lifeos';

// ---------------------------------------------------------------- smart inbox

/**
 * Smart inbox: a Documents folder the person chose. Files that arrive in it are read and turned into tasks,
 * reminders, events, lists and so on. One per person.
 */
export const inboxSettings = pgTable('inbox_settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** The "LifeSphere Inbox" folder in Documents; its subfolders hint at what each file is. */
  folderId: uuid('folder_id').references(() => docFolders.id, { onDelete: 'set null' }),
  enabled: boolean('enabled').notNull().default(true),
  /** When the person agreed that files in the inbox are sent to the AI provider to be read. Null: text files only. */
  aiConsentAt: ts('ai_consent_at'),
  /** Optional household that new shopping lists, inventory and budget lines go into. */
  householdId: uuid('household_id').references(() => households.id, { onDelete: 'set null' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const inboxImportStatus = pgEnum('inbox_import_status', ['queued', 'processing', 'done', 'needs_review', 'failed', 'skipped', 'undone']);

/** One file that arrived in the inbox, and what was made from it. */
export const inboxImports = pgTable(
  'inbox_imports',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    fileId: uuid('file_id').references(() => docFiles.id, { onDelete: 'set null' }),
    fileName: varchar('file_name', { length: 200 }).notNull(),
    fileSha256: varchar('file_sha256', { length: 64 }).notNull(),
    /** Category hint from the subfolder the file was put in, if any. */
    folderHint: varchar('folder_hint', { length: 40 }),
    status: inboxImportStatus('status').notNull().default('queued'),
    /** What the file was recognised as, e.g. "tasks", "shopping", "mixed". */
    category: varchar('category', { length: 40 }),
    summary: text('summary'),
    /** Records created: [{ type, id, title, href, parentId? }] */
    createdItems: jsonb('created_items').$type<InboxCreatedItem[]>().notNull().default([]),
    /** Things found that the person decides on: [{ type, title, details, href }] */
    suggestions: jsonb('suggestions').$type<InboxSuggestion[]>().notNull().default([]),
    /** Items that could not be used, with the reason (kept short). */
    skippedItems: jsonb('skipped_items').$type<{ title: string; reason: string }[]>().notNull().default([]),
    error: varchar('error', { length: 300 }),
    reader: varchar('reader', { length: 20 }),
    attempts: integer('attempts').notNull().default(0),
    createdAt: createdAt(),
    processedAt: ts('processed_at'),
    undoneAt: ts('undone_at'),
  },
  (t) => [index('inbox_imports_user_idx').on(t.userId, t.createdAt), uniqueIndex('inbox_imports_file_uq').on(t.fileId)],
);

export interface InboxCreatedItem {
  type: string;
  id: string;
  title: string;
  href: string;
  /** For list items and maintenance schedules: the list or inventory item they belong to. */
  parentId?: string;
  /** The parent was created by this import too (removed on undo when it is empty). */
  parentCreated?: boolean;
}

export interface InboxSuggestion {
  type: string;
  title: string;
  details: string;
  href: string;
}
