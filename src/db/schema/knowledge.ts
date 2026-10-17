import { sql, type SQL } from 'drizzle-orm';
import {
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { createdAt, id, ts, updatedAt } from './_columns';
import { aiRole, articleStatus, feedbackRating, sourceKind } from './enums';
import { users } from './identity';

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

export const knowledgeSources = pgTable(
  'knowledge_sources',
  {
    id: id(),
    name: varchar('name', { length: 160 }).notNull(),
    publisher: varchar('publisher', { length: 160 }),
    url: varchar('url', { length: 400 }),
    kind: sourceKind('kind').notNull(),
    /** 1 = official/primary, 2 = reputable secondary, 3 = internal guidance. */
    reliabilityTier: smallint('reliability_tier').notNull().default(2),
    reliabilityNote: varchar('reliability_note', { length: 500 }),
    active: boolean('active').notNull().default(true),
    reviewIntervalDays: integer('review_interval_days').notNull().default(180),
    lastIngestedAt: ts('last_ingested_at'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('ks_url_uq').on(t.url).where(sql`${t.url} is not null`)],
);

export const knowledgeArticles = pgTable(
  'knowledge_articles',
  {
    id: id(),
    sourceId: uuid('source_id')
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: 'cascade' }),
    slug: varchar('slug', { length: 160 }).notNull(),
    title: varchar('title', { length: 240 }).notNull(),
    summary: varchar('summary', { length: 1000 }),
    body: text('body').notNull(),
    /** Link to the original official resource. */
    canonicalUrl: varchar('canonical_url', { length: 400 }),
    topic: varchar('topic', { length: 60 }).notNull(),
    language: varchar('language', { length: 10 }).notNull().default('en'),
    /** ISO country the guide applies to; null = general guidance for everyone. */
    country: varchar('country', { length: 2 }),
    publishedOn: date('published_on'),
    lastReviewedOn: date('last_reviewed_on'),
    status: articleStatus('status').notNull().default('draft'),
    /** General information disclaimer shown with the article. */
    disclaimer: varchar('disclaimer', { length: 300 }),
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      (): SQL =>
        sql`setweight(to_tsvector('english', coalesce(${knowledgeArticles.title}, '')), 'A') || setweight(to_tsvector('english', coalesce(${knowledgeArticles.summary}, '')), 'B') || setweight(to_tsvector('english', coalesce(${knowledgeArticles.body}, '')), 'C')`,
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('ka_slug_uq').on(t.slug),
    index('ka_topic_idx').on(t.topic, t.status),
    index('ka_search_idx').using('gin', t.searchVector),
  ],
);

export const knowledgeChunks = pgTable(
  'knowledge_chunks',
  {
    id: id(),
    articleId: uuid('article_id')
      .notNull()
      .references(() => knowledgeArticles.id, { onDelete: 'cascade' }),
    ordinal: integer('ordinal').notNull(),
    heading: varchar('heading', { length: 240 }),
    content: text('content').notNull(),
    tokenCount: integer('token_count').notNull(),
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      (): SQL => sql`to_tsvector('english', coalesce(${knowledgeChunks.heading}, '') || ' ' || ${knowledgeChunks.content})`,
    ),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('kc_article_ord_uq').on(t.articleId, t.ordinal),
    index('kc_search_idx').using('gin', t.searchVector),
  ],
);
// Note: embeddings live in `knowledge_chunk_embeddings` (pgvector), created by an optional
// migration only where the `vector` extension is available. Accessed through raw SQL.

export const aiConversations = pgTable(
  'ai_conversations',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: varchar('title', { length: 120 }),
    /** Purged by the retention job when the user has history storage off, or after 30 days. */
    expiresAt: ts('expires_at').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('ai_conv_user_idx').on(t.userId, t.createdAt), index('ai_conv_expiry_idx').on(t.expiresAt)],
);

export type Citation = { articleId: string; chunkId: string; title: string; url: string | null; lastReviewedOn: string | null };
export type ProposedAction = { type: 'create_task' | 'create_reminder' | 'open_workflow'; payload: Record<string, unknown>; label: string };

export const aiMessages = pgTable(
  'ai_messages',
  {
    id: id(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => aiConversations.id, { onDelete: 'cascade' }),
    role: aiRole('role').notNull(),
    content: text('content').notNull(),
    citations: jsonb('citations').$type<Citation[]>().notNull().default([]),
    /** Actions the assistant proposes; the client must ask the user to confirm and call the real endpoint. */
    proposedActions: jsonb('proposed_actions').$type<ProposedAction[]>().notNull().default([]),
    model: varchar('model', { length: 80 }),
    createdAt: createdAt(),
  },
  (t) => [index('ai_msg_conv_idx').on(t.conversationId, t.createdAt)],
);

export const aiFeedback = pgTable(
  'ai_feedback',
  {
    id: id(),
    /** Null when the answer was not stored (history off). */
    messageId: uuid('message_id'),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    rating: feedbackRating('rating').notNull(),
    reason: varchar('reason', { length: 60 }),
    comment: varchar('comment', { length: 1000 }),
    /** Citations shown with the rated answer (kept for quality evaluation; no user content). */
    citedArticleIds: uuid('cited_article_ids').array(),
    createdAt: createdAt(),
  },
  (t) => [index('ai_feedback_created_idx').on(t.createdAt)],
);

/** Offline evaluation set: question → expected article(s), run by admins to track retrieval quality. */
export const aiEvalCases = pgTable('ai_eval_cases', {
  id: id(),
  question: varchar('question', { length: 500 }).notNull(),
  expectedArticleIds: uuid('expected_article_ids').array().notNull(),
  mustNotContain: text('must_not_contain').array(),
  createdAt: createdAt(),
});

export const aiEvalRuns = pgTable('ai_eval_runs', {
  id: id(),
  startedBy: uuid('started_by').references(() => users.id, { onDelete: 'set null' }),
  totalCases: integer('total_cases').notNull(),
  retrievalHits: integer('retrieval_hits').notNull(),
  results: jsonb('results').notNull(),
  createdAt: createdAt(),
});
