import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { AiAdapter } from '../../adapters/ai';
import { StorageAdapter } from '../../adapters/storage';
import { Actor } from '../../common/auth-context';
import { AuditService } from '../../common/audit.service';
import { countryInfo } from '../../common/countries';
import { AppError, badRequest, notFound } from '../../common/errors';
import { uuidv7 } from '../../common/ids';
import { JOBS, QueueService } from '../../common/queue.service';
import { localParts } from '../../common/time';
import { Database, DB } from '../../db/db';
import { docFiles, docFolders, householdMembers, inboxImports, inboxSettings, userPreferences, userProfiles } from '../../db/schema';
import { CalendarService } from '../calendar/calendar.service';
import { CheckinsService } from '../checkins/checkins.service';
import { CommunityService } from '../community/community.service';
import { ConsumerService } from '../consumer/consumer.service';
import { DocumentsService } from '../documents/documents.service';
import { HouseholdToolsService } from '../household-tools/household-tools.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RemindersService } from '../reminders/reminders.service';
import { TasksService } from '../tasks/tasks.service';
import { Category, EXTRACT_TOOL, Extraction, INBOX_FOLDERS, INBOX_ROOT, ruleBasedExtract, sanitize, systemPrompt } from './extraction';
import { readDocument } from './readers';
import { applyItems, RecordServices, undoItems } from './records';

type Import = typeof inboxImports.$inferSelect;
type DocFile = typeof docFiles.$inferSelect;

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Smart inbox: files that arrive in the person's "LifeSphere Inbox" folder (uploaded in the app, or synced from a
 * folder on their computer) are read and turned into their own tasks, reminders, events, lists, inventory, budget,
 * medicines and records. Anything that would reach other people is only suggested.
 */
@Injectable()
export class InboxService implements OnModuleInit {
  private readonly logger = new Logger('Inbox');
  private readonly svc: RecordServices;

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly documents: DocumentsService,
    private readonly storage: StorageAdapter,
    private readonly ai: AiAdapter,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    tasks: TasksService,
    reminders: RemindersService,
    calendar: CalendarService,
    tools: HouseholdToolsService,
    checkins: CheckinsService,
    consumer: ConsumerService,
    community: CommunityService,
  ) {
    this.svc = { tasks, reminders, calendar, tools, checkins, consumer, community };
  }

  onModuleInit() {
    this.documents.fileListeners.push((f: DocFile) => this.onFileArrived(f));
  }

  // ---------------------------------------------------------------------------------------------- settings

  private async settings(userId: string) {
    const [s] = await this.db.select().from(inboxSettings).where(eq(inboxSettings.userId, userId));
    return s ?? null;
  }

  /** Folder id → { name, parentId } for the person's live folders. */
  private async folderMap(userId: string) {
    const rows = await this.db
      .select({ id: docFolders.id, name: docFolders.name, parentId: docFolders.parentId })
      .from(docFolders)
      .where(and(eq(docFolders.ownerUserId, userId), isNull(docFolders.deletedAt)));
    return new Map(rows.map((r) => [r.id, r]));
  }

  /** If folderId is inside the inbox, the category hint of its inbox subfolder (null for the inbox itself). */
  private hintFor(folders: Map<string, { name: string; parentId: string | null }>, rootId: string, folderId: string): { inside: boolean; hint: Category | null } {
    let cur: string | null = folderId;
    let childOfRoot: string | null = null;
    for (let depth = 0; cur && depth < 20; depth++) {
      if (cur === rootId) {
        const name = childOfRoot ? folders.get(childOfRoot)?.name : null;
        return { inside: true, hint: INBOX_FOLDERS.find((f) => f.name.toLowerCase() === name?.toLowerCase())?.hint ?? null };
      }
      childOfRoot = cur;
      cur = folders.get(cur)?.parentId ?? null;
    }
    return { inside: false, hint: null };
  }

  async status(actor: Actor) {
    const s = await this.settings(actor.userId);
    const folders = await this.folderMap(actor.userId);
    const root = s?.folderId && folders.has(s.folderId) ? s.folderId : null;
    const sub = root
      ? INBOX_FOLDERS.map((f) => {
          const found = [...folders.entries()].find(([, v]) => v.parentId === root && v.name.toLowerCase() === f.name.toLowerCase());
          return { name: f.name, hint: f.hint, folderId: found?.[0] ?? null };
        })
      : INBOX_FOLDERS.map((f) => ({ name: f.name, hint: f.hint, folderId: null }));
    const [counts] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        waiting: sql<number>`count(*) filter (where ${inboxImports.status} in ('queued','processing'))::int`,
        review: sql<number>`count(*) filter (where ${inboxImports.status} = 'needs_review')::int`,
      })
      .from(inboxImports)
      .where(eq(inboxImports.userId, actor.userId));
    const [prefs] = await this.db.select({ ai: userPreferences.aiEnabled }).from(userPreferences).where(eq(userPreferences.userId, actor.userId));
    return {
      setUp: !!root,
      enabled: !!s?.enabled && !!root,
      rootFolderId: root,
      rootName: INBOX_ROOT,
      folders: sub,
      aiReading: !!s?.aiConsentAt && prefs?.ai !== false && !this.ai.simulated,
      aiConsentAt: s?.aiConsentAt ?? null,
      aiAvailable: !this.ai.simulated,
      aiTurnedOffInSettings: prefs?.ai === false,
      householdId: s?.householdId ?? null,
      counts: counts ?? { total: 0, waiting: 0, review: 0 },
    };
  }

  /** Creates the inbox folder and its subfolders in Documents (reusing any that already exist) and turns it on. */
  async setup(actor: Actor, dto: { aiConsent?: boolean; householdId?: string | null }) {
    if (dto.householdId) await this.requireMember(actor.userId, dto.householdId);
    const folders = await this.folderMap(actor.userId);
    const s = await this.settings(actor.userId);
    let rootId = s?.folderId && folders.has(s.folderId) ? s.folderId : [...folders.entries()].find(([, v]) => !v.parentId && v.name === INBOX_ROOT)?.[0];
    if (!rootId) rootId = (await this.documents.createFolder(actor.userId, INBOX_ROOT, null)).id;
    for (const f of INBOX_FOLDERS) {
      const exists = [...folders.values()].some((v) => v.parentId === rootId && v.name.toLowerCase() === f.name.toLowerCase());
      if (!exists) await this.documents.createFolder(actor.userId, f.name, rootId);
    }
    const now = new Date();
    const values = {
      folderId: rootId,
      enabled: true,
      ...(dto.aiConsent === true ? { aiConsentAt: s?.aiConsentAt ?? now } : dto.aiConsent === false ? { aiConsentAt: null } : {}),
      ...(dto.householdId !== undefined ? { householdId: dto.householdId } : {}),
    };
    await this.db
      .insert(inboxSettings)
      .values({ userId: actor.userId, ...values })
      .onConflictDoUpdate({ target: inboxSettings.userId, set: values });
    await this.audit.record(actor, {
      action: 'inbox.setup',
      targetType: 'inbox',
      targetId: actor.userId,
      subjectUserId: actor.userId,
      metadata: { aiConsent: dto.aiConsent ?? null },
    });
    // Files already sitting in the folders are picked up now.
    await this.scanUser(actor.userId);
    return this.status(actor);
  }

  async update(actor: Actor, dto: { enabled?: boolean; aiConsent?: boolean; householdId?: string | null }) {
    const s = await this.settings(actor.userId);
    if (!s) throw new AppError(409, 'inbox_not_set_up', 'Set up the smart inbox first.');
    if (dto.householdId) await this.requireMember(actor.userId, dto.householdId);
    const patch: Partial<typeof inboxSettings.$inferInsert> = {};
    if (dto.enabled !== undefined) patch.enabled = dto.enabled;
    if (dto.aiConsent !== undefined) patch.aiConsentAt = dto.aiConsent ? (s.aiConsentAt ?? new Date()) : null;
    if (dto.householdId !== undefined) patch.householdId = dto.householdId;
    if (Object.keys(patch).length) await this.db.update(inboxSettings).set(patch).where(eq(inboxSettings.userId, actor.userId));
    if (dto.aiConsent !== undefined)
      await this.audit.record(actor, { action: dto.aiConsent ? 'inbox.ai_consent_given' : 'inbox.ai_consent_withdrawn', targetType: 'inbox', targetId: actor.userId, subjectUserId: actor.userId });
    if (dto.enabled) await this.scanUser(actor.userId);
    return this.status(actor);
  }

  private async requireMember(userId: string, householdId: string) {
    const [m] = await this.db
      .select({ id: householdMembers.userId })
      .from(householdMembers)
      .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)))
      .limit(1);
    if (!m) throw notFound('Household');
  }

  // ---------------------------------------------------------------------------------------------- imports

  out(i: Import) {
    return {
      id: i.id,
      fileId: i.fileId,
      fileName: i.fileName,
      folderHint: i.folderHint,
      status: i.status,
      category: i.category,
      summary: i.summary,
      createdItems: i.createdItems,
      suggestions: i.suggestions,
      skippedItems: i.skippedItems,
      error: i.error,
      reader: i.reader,
      createdAt: i.createdAt,
      processedAt: i.processedAt,
      undoneAt: i.undoneAt,
    };
  }

  async list(actor: Actor, limit = 50) {
    const rows = await this.db
      .select()
      .from(inboxImports)
      .where(eq(inboxImports.userId, actor.userId))
      .orderBy(desc(inboxImports.createdAt))
      .limit(Math.min(Math.max(limit, 1), 200));
    return rows.map((r) => this.out(r));
  }

  private async own(actor: Actor, id: string) {
    const [i] = await this.db.select().from(inboxImports).where(and(eq(inboxImports.id, id), eq(inboxImports.userId, actor.userId)));
    if (!i) throw notFound('Import');
    return i;
  }

  async get(actor: Actor, id: string) {
    return this.out(await this.own(actor, id));
  }

  async undo(actor: Actor, id: string) {
    const i = await this.own(actor, id);
    if (i.undoneAt) return this.out(i);
    if (i.status === 'queued' || i.status === 'processing') throw new AppError(409, 'inbox_busy', 'This file is still being read. Try again in a moment.');
    const removed = await undoItems(this.svc, actor, i.createdItems);
    const [u] = await this.db.update(inboxImports).set({ status: 'undone', undoneAt: new Date() }).where(eq(inboxImports.id, id)).returning();
    await this.audit.record(actor, { action: 'inbox.undone', targetType: 'inbox_import', targetId: id, subjectUserId: actor.userId, metadata: { removed } });
    return this.out(u);
  }

  async retry(actor: Actor, id: string) {
    const i = await this.own(actor, id);
    if (!['failed', 'needs_review', 'skipped', 'undone'].includes(i.status)) throw badRequest('Only finished files can be read again', 'inbox_not_retryable');
    if (i.createdItems.length && !i.undoneAt) throw new AppError(409, 'inbox_undo_first', 'Undo this file first, so nothing is added twice.');
    const [u] = await this.db
      .update(inboxImports)
      .set({ status: 'queued', error: null, createdItems: [], suggestions: [], skippedItems: [], undoneAt: null, processedAt: null })
      .where(eq(inboxImports.id, id))
      .returning();
    await this.enqueue(u.id);
    return this.out(u);
  }

  /** Remove a suggestion once the person has dealt with it. */
  async dismissSuggestion(actor: Actor, id: string, index: number) {
    const i = await this.own(actor, id);
    const suggestions = i.suggestions.filter((_, n) => n !== index);
    const status = i.status === 'needs_review' && !suggestions.length ? 'done' : i.status;
    const [u] = await this.db.update(inboxImports).set({ suggestions, status }).where(eq(inboxImports.id, id)).returning();
    return this.out(u);
  }

  // ---------------------------------------------------------------------------------------------- arrival

  private async enqueue(importId: string) {
    await this.queue.send(JOBS.inboxProcess, { importId }, { singletonKey: `inbox-${importId}`, retryLimit: 2, retryDelay: 60, retryBackoff: true });
  }

  /** A file was stored or moved. If it is inside the person's inbox, queue it for reading. */
  async onFileArrived(f: DocFile) {
    const s = await this.settings(f.ownerUserId);
    if (!s?.enabled || !s.folderId) return;
    const folders = await this.folderMap(f.ownerUserId);
    const { inside, hint } = this.hintFor(folders, s.folderId, f.folderId);
    if (!inside) return;
    await this.queueFile(f, hint);
  }

  private async queueFile(f: Pick<DocFile, 'id' | 'ownerUserId' | 'name' | 'sha256'>, hint: Category | null) {
    const [row] = await this.db
      .insert(inboxImports)
      .values({ userId: f.ownerUserId, fileId: f.id, fileName: f.name, fileSha256: f.sha256, folderHint: hint })
      .onConflictDoNothing({ target: inboxImports.fileId })
      .returning();
    if (row) await this.enqueue(row.id);
    return row ?? null;
  }

  /** Safety net (worker, every few minutes) and "check now": queue inbox files that have no import yet. */
  async scanUser(userId: string) {
    const s = await this.settings(userId);
    if (!s?.enabled || !s.folderId) return 0;
    const folders = await this.folderMap(userId);
    const inside = [...folders.keys()].filter((id) => this.hintFor(folders, s.folderId!, id).inside);
    if (!inside.length) return 0;
    const seen = this.db.select({ id: inboxImports.fileId }).from(inboxImports).where(and(eq(inboxImports.userId, userId), sql`${inboxImports.fileId} is not null`));
    const files = await this.db
      .select({ id: docFiles.id, ownerUserId: docFiles.ownerUserId, name: docFiles.name, sha256: docFiles.sha256, folderId: docFiles.folderId })
      .from(docFiles)
      .where(and(eq(docFiles.ownerUserId, userId), inArray(docFiles.folderId, inside), isNull(docFiles.deletedAt), notInArray(docFiles.id, seen)))
      .limit(200);
    let n = 0;
    for (const f of files) if (await this.queueFile(f, this.hintFor(folders, s.folderId, f.folderId).hint)) n++;
    return n;
  }

  async scanAll() {
    const users = await this.db.select({ id: inboxSettings.userId }).from(inboxSettings).where(eq(inboxSettings.enabled, true));
    let n = 0;
    for (const u of users) n += await this.scanUser(u.id).catch(() => 0);
    // Imports stuck in "processing" (worker restarted mid-way) are queued again.
    const stuck = await this.db
      .update(inboxImports)
      .set({ status: 'queued' })
      .where(and(eq(inboxImports.status, 'processing'), sql`${inboxImports.createdAt} < now() - interval '15 minutes'`, sql`${inboxImports.attempts} < 3`))
      .returning({ id: inboxImports.id });
    for (const s of stuck) await this.enqueue(s.id);
    return n + stuck.length;
  }

  // ---------------------------------------------------------------------------------------------- reading

  private async readStored(key: string): Promise<Buffer> {
    const stream = await this.storage.getStream(key);
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    return Buffer.concat(chunks);
  }

  private finish(id: string, patch: Partial<typeof inboxImports.$inferInsert>) {
    return this.db
      .update(inboxImports)
      .set({ ...patch, processedAt: new Date() })
      .where(eq(inboxImports.id, id))
      .returning();
  }

  /** Worker job: read one file and add what it contains. Safe to run twice. */
  async process(importId: string) {
    const [claimed] = await this.db
      .update(inboxImports)
      .set({ status: 'processing', attempts: sql`${inboxImports.attempts} + 1` })
      .where(and(eq(inboxImports.id, importId), eq(inboxImports.status, 'queued')))
      .returning();
    if (!claimed) return;
    const userId = claimed.userId;
    try {
      const s = await this.settings(userId);
      if (!s?.enabled) return void (await this.finish(importId, { status: 'skipped', error: 'The smart inbox was paused.' }));
      const [file] = claimed.fileId ? await this.db.select().from(docFiles).where(eq(docFiles.id, claimed.fileId)) : [];
      if (!file || file.deletedAt) return void (await this.finish(importId, { status: 'skipped', error: 'The file was removed before it could be read.' }));

      const [dup] = await this.db
        .select({ id: inboxImports.id, fileName: inboxImports.fileName })
        .from(inboxImports)
        .where(
          and(
            eq(inboxImports.userId, userId),
            eq(inboxImports.fileSha256, file.sha256),
            inArray(inboxImports.status, ['done', 'needs_review']),
            isNull(inboxImports.undoneAt),
            sql`${inboxImports.id} <> ${importId}`,
          ),
        )
        .limit(1);
      if (dup) return void (await this.finish(importId, { status: 'skipped', error: `Same file as "${dup.fileName}", which was already added.`.slice(0, 300) }));

      const [profile] = await this.db.select({ tz: userProfiles.timezone, country: userProfiles.country }).from(userProfiles).where(eq(userProfiles.userId, userId));
      const [prefs] = await this.db.select({ ai: userPreferences.aiEnabled, off: userPreferences.disabledFeatures }).from(userPreferences).where(eq(userPreferences.userId, userId));
      const timeZone = profile?.tz ?? 'UTC';
      const p = localParts(new Date(), timeZone);
      const pad = (x: number) => String(x).padStart(2, '0');
      const today = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
      const weekday = WEEKDAYS[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()];
      const currency = countryInfo(profile?.country ?? null).currency;
      const hint = (claimed.folderHint as Category | null) ?? null;
      const useAi = !!s.aiConsentAt && prefs?.ai !== false && !this.ai.simulated;

      const content = readDocument(file.mimeType, await this.readStored(file.storageKey), file.textContent);
      if (content.kind === 'unsupported') return void (await this.finish(importId, { status: 'failed', error: content.reason }));
      if (content.kind !== 'text' && !useAi) {
        return void (await this.finish(importId, {
          status: 'needs_review',
          reader: 'none',
          error: this.ai.simulated
            ? 'PDFs and photos need AI reading, which is not set up on this server yet.'
            : 'PDFs and photos are read by AI. Turn on AI reading for the smart inbox to read this file.',
        }));
      }

      let extraction: Extraction;
      let reader: string;
      if (useAi) {
        const system = systemPrompt({ today, weekday, timeZone, currency, hint, fileName: file.name });
        const block =
          content.kind === 'text'
            ? { type: 'text' as const, text: `<document name="${file.name.replace(/"/g, "'")}">\n${content.text}\n</document>` }
            : content.kind === 'pdf'
              ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: content.base64 } }
              : { type: 'image' as const, source: { type: 'base64' as const, media_type: content.mediaType, data: content.base64 } };
        try {
          const r = await this.ai.extract(system, [block, { type: 'text', text: 'Read this document and save what it contains.' }], EXTRACT_TOOL);
          if (!r) throw new Error('no answer');
          extraction = sanitize(r.input);
          reader = 'ai';
        } catch (e) {
          // Text can still be read with the simple rules; PDFs and photos wait for a retry.
          if (content.kind !== 'text') throw e;
          extraction = ruleBasedExtract(content.text, hint, today);
          reader = 'rules';
        }
      } else {
        extraction = ruleBasedExtract((content as { text: string }).text, hint, today);
        reader = 'rules';
      }

      const actor: Actor = { userId, sessionId: uuidv7(), amr: ['inbox'], mfaVerified: false, sessionCreatedAt: new Date(), reauthAt: null, staffRoles: [], ipHash: null };
      const result = await applyItems(this.svc, { actor, timeZone, today, currency, householdId: s.householdId, disabled: new Set(prefs?.off ?? []), fileName: file.name }, extraction.items);
      const status = result.suggestions.length || (!result.created.length && (result.skipped.length || !extraction.items.length)) ? 'needs_review' : 'done';
      const [done] = await this.finish(importId, {
        status,
        reader,
        category: extraction.category,
        summary: extraction.summary || null,
        createdItems: result.created,
        suggestions: result.suggestions,
        skippedItems: result.skipped.slice(0, 50),
        error: !extraction.items.length ? (reader === 'rules' ? 'Nothing was recognised. Put the file in the right subfolder, or turn on AI reading.' : 'Nothing to add was found in this file.') : null,
      });
      await this.audit.system({
        action: 'inbox.file_read',
        targetType: 'inbox_import',
        targetId: importId,
        subjectUserId: userId,
        metadata: { reader, category: extraction.category, created: result.created.length, suggested: result.suggestions.length, skipped: result.skipped.length },
      });
      if (result.created.length || result.suggestions.length) {
        const n = result.created.length;
        await this.notifications
          .notify({
            userId,
            category: 'system',
            template: 'inbox_imported',
            title: n ? `Added ${n} item${n === 1 ? '' : 's'} from "${file.name}"` : `"${file.name}" has things for you to review`,
            body: result.suggestions.length ? `${result.suggestions.length} to review in your smart inbox.` : undefined,
            data: { type: 'inbox_import', id: importId },
            related: { type: 'inbox_import', id: importId },
          })
          .catch(() => undefined);
      }
      return done;
    } catch (e) {
      const err = e as { detail?: string; message?: string };
      this.logger.warn(`Inbox import ${importId} failed: ${err.message ?? e}`);
      await this.finish(importId, { status: 'failed', error: (err.detail ?? 'The file could not be read right now. Press Try again.').slice(0, 300) });
    }
  }
}
