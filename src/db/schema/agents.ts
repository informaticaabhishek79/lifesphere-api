import { bigint, boolean, index, jsonb, pgEnum, pgTable, primaryKey, text, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { createdAt, deletedAt, id, ts, updatedAt } from './_columns';
import { users } from './identity';

// ---------------------------------------------------------------- documents

/** A person's own folders. Nesting is allowed; a folder belongs to exactly one owner. */
export const docFolders = pgTable(
  'doc_folders',
  {
    id: id(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => docFolders.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 120 }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index('doc_folders_owner_idx').on(t.ownerUserId, t.parentId)],
);

/** Files always live inside a folder, so access can be granted folder by folder. */
export const docFiles = pgTable(
  'doc_files',
  {
    id: id(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    folderId: uuid('folder_id')
      .notNull()
      .references(() => docFolders.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 200 }).notNull(),
    mimeType: varchar('mime_type', { length: 120 }).notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
    storageKey: varchar('storage_key', { length: 300 }).notNull(),
    sha256: varchar('sha256', { length: 64 }).notNull(),
    /** Plain text kept for text files only, so an agent can read them. Null for images and binary formats. */
    textContent: text('text_content'),
    /** Who last changed it: the person, or one of their agents. */
    lastChangedByAgentId: uuid('last_changed_by_agent_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    /** Set when moved to the bin; purged after SOFT_DELETE_PURGE_DAYS. */
    deletedAt: deletedAt(),
  },
  (t) => [uniqueIndex('doc_files_key_uq').on(t.storageKey), index('doc_files_folder_idx').on(t.folderId), index('doc_files_owner_idx').on(t.ownerUserId)],
);

// ---------------------------------------------------------------- mailboxes

export const mailProvider = pgEnum('mail_provider', ['demo', 'gmail', 'outlook']);

/** A mailbox the person connected. Tokens are encrypted; only read + send scopes are requested. */
export const mailAccounts = pgTable(
  'mail_accounts',
  {
    id: id(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    provider: mailProvider('provider').notNull(),
    address: varchar('address', { length: 254 }).notNull(),
    /** AES-GCM encrypted JSON {accessToken, refreshToken, expiresAt}. Null for the demo mailbox. */
    tokensEnc: text('tokens_enc'),
    status: varchar('status', { length: 20 }).notNull().default('active'),
    lastError: varchar('last_error', { length: 300 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('mail_accounts_owner_idx').on(t.ownerUserId)],
);

/** One-time OAuth state, so a callback can only finish a sign-in the same person started. */
export const mailOauthStates = pgTable('mail_oauth_states', {
  state: varchar('state', { length: 64 }).primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  provider: mailProvider('provider').notNull(),
  expiresAt: ts('expires_at').notNull(),
});

// ---------------------------------------------------------------- agents

export const agentKind = pgEnum('agent_kind', ['email', 'documents']);
export const agentStatus = pgEnum('agent_status', ['active', 'paused']);
export const folderAccess = pgEnum('folder_access', ['read', 'edit']);
export const agentRunStatus = pgEnum('agent_run_status', ['awaiting_approval', 'sent', 'completed', 'failed', 'discarded']);

export const agents = pgTable(
  'agents',
  {
    id: id(),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: agentKind('kind').notNull(),
    name: varchar('name', { length: 80 }).notNull(),
    /** Standing instructions from the person, e.g. tone or signature. */
    instructions: text('instructions'),
    status: agentStatus('status').notNull().default('active'),
    /** Email agents: the one mailbox they may use. */
    mailAccountId: uuid('mail_account_id').references(() => mailAccounts.id, { onDelete: 'set null' }),
    /** Email agents: send as soon as asked, or hold the reply for approval. */
    reviewBeforeSending: boolean('review_before_sending').notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index('agents_owner_idx').on(t.ownerUserId)],
);

/** Documents agents see a folder (and everything inside it) only when granted here. */
export const agentFolderGrants = pgTable(
  'agent_folder_grants',
  {
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    folderId: uuid('folder_id')
      .notNull()
      .references(() => docFolders.id, { onDelete: 'cascade' }),
    access: folderAccess('access').notNull().default('read'),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.agentId, t.folderId] }), index('agent_folder_grants_folder_idx').on(t.folderId)],
);

export interface AgentAction {
  tool: string;
  input: Record<string, unknown>;
  ok: boolean;
  note: string;
}

/** Every request made to an agent, what it did, and the result. This is the person's activity log. */
export const agentRuns = pgTable(
  'agent_runs',
  {
    id: id(),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    ownerUserId: uuid('owner_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    request: text('request').notNull(),
    /** Email: the provider message id it replied to. Documents: the folder it started in. */
    targetRef: varchar('target_ref', { length: 300 }),
    /** Short label for the log, e.g. the email subject and sender. */
    targetLabel: varchar('target_label', { length: 300 }),
    status: agentRunStatus('status').notNull(),
    output: text('output'),
    actions: jsonb('actions').$type<AgentAction[]>().notNull().default([]),
    error: varchar('error', { length: 300 }),
    aiModel: varchar('ai_model', { length: 80 }),
    simulated: boolean('simulated').notNull().default(false),
    createdAt: createdAt(),
    finishedAt: ts('finished_at'),
  },
  (t) => [index('agent_runs_agent_idx').on(t.agentId, t.createdAt), index('agent_runs_owner_idx').on(t.ownerUserId, t.createdAt)],
);

// ---------------------------------------------------------------- voice assistant

/** What the personal (voice) assistant may look at beyond the features you have switched on. */
export const assistantSettings = pgTable('assistant_settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** Document folders it may search and read (folders inside are included). Empty = no documents. */
  documentFolderIds: uuid('document_folder_ids').array().notNull().default([]),
  speakAnswers: boolean('speak_answers').notNull().default(true),
  updatedAt: updatedAt(),
});
