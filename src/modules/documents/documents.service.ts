import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Response } from 'express';
import { StorageAdapter } from '../../adapters/storage';
import { Actor } from '../../common/auth-context';
import { AuditService } from '../../common/audit.service';
import { CryptoService } from '../../common/crypto.service';
import { AppError, badRequest, notFound } from '../../common/errors';
import { uuidv7 } from '../../common/ids';
import { Env, ENV } from '../../config/env';
import { Database, DB } from '../../db/db';
import { docFiles, docFolders } from '../../db/schema';
import { sniffMime } from '../attachments/attachments.service';

type Folder = typeof docFolders.$inferSelect;
type File = typeof docFiles.$inferSelect;

const OFFICE: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};
const TEXT: Record<string, string> = { txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json' };
export const TEXT_TYPES = new Set(Object.values(TEXT));

/** Strip path separators and control characters; keep names short and readable. */
export function cleanName(raw: string, fallback = 'Untitled'): string {
  // eslint-disable-next-line no-control-regex
  const n = raw.replace(/[\u0000-\u001f\u007f/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!n || n === '.' || n === '..') return fallback;
  return n;
}

const ext = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '');

/** Decide the stored type from the bytes; the browser's claim is never trusted. */
export function detectDocType(buf: Buffer, name: string): string | null {
  const sniffed = sniffMime(buf);
  if (sniffed) return sniffed;
  const e = ext(name);
  if (buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return OFFICE[e] ?? null;
  // Text: valid UTF-8 with no NUL bytes.
  const head = buf.subarray(0, 64 * 1024);
  if (head.includes(0)) return null;
  const decoded = new TextDecoder('utf-8', { fatal: false }).decode(head);
  if (decoded.includes('�')) return null;
  return TEXT[e] ?? 'text/plain';
}

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly storage: StorageAdapter,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------ shapes
  folderOut(f: Folder, paths?: Map<string, string>) {
    return { id: f.id, name: f.name, parentId: f.parentId, path: paths?.get(f.id) ?? f.name, createdAt: f.createdAt, updatedAt: f.updatedAt, deletedAt: f.deletedAt };
  }

  fileOut(f: File) {
    return {
      id: f.id,
      folderId: f.folderId,
      name: f.name,
      mimeType: f.mimeType,
      sizeBytes: f.sizeBytes,
      readableText: f.textContent !== null,
      lastChangedByAgentId: f.lastChangedByAgentId,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
      deletedAt: f.deletedAt,
    };
  }

  // ------------------------------------------------------------ folders
  async allFolders(ownerId: string) {
    return this.db.select().from(docFolders).where(and(eq(docFolders.ownerUserId, ownerId), isNull(docFolders.deletedAt))).orderBy(asc(docFolders.name));
  }

  /** "Bills / 2026 / Electricity" for every folder of this person. */
  async paths(ownerId: string, folders?: Folder[]) {
    const all = folders ?? (await this.allFolders(ownerId));
    const byId = new Map(all.map((f) => [f.id, f]));
    const out = new Map<string, string>();
    const walk = (f: Folder, depth = 0): string => {
      if (out.has(f.id)) return out.get(f.id)!;
      const parent = f.parentId ? byId.get(f.parentId) : undefined;
      const p = parent && depth < 50 ? `${walk(parent, depth + 1)} / ${f.name}` : f.name;
      out.set(f.id, p);
      return p;
    };
    all.forEach((f) => walk(f));
    return out;
  }

  async listFolders(actor: Actor) {
    const all = await this.allFolders(actor.userId);
    const paths = await this.paths(actor.userId, all);
    const counts = await this.db
      .select({ folderId: docFiles.folderId, n: sql<number>`count(*)::int` })
      .from(docFiles)
      .where(and(eq(docFiles.ownerUserId, actor.userId), isNull(docFiles.deletedAt)))
      .groupBy(docFiles.folderId);
    const c = new Map(counts.map((r) => [r.folderId, r.n]));
    return all.map((f) => ({ ...this.folderOut(f, paths), fileCount: c.get(f.id) ?? 0 })).sort((a, b) => a.path.localeCompare(b.path));
  }

  async folder(ownerId: string, id: string) {
    const [f] = await this.db.select().from(docFolders).where(and(eq(docFolders.id, id), eq(docFolders.ownerUserId, ownerId), isNull(docFolders.deletedAt)));
    if (!f) throw notFound('Folder');
    return f;
  }

  /** The folder and every folder inside it (live ones only). */
  async subtree(ownerId: string, rootIds: string[]): Promise<string[]> {
    if (!rootIds.length) return [];
    const r = await this.db.execute<{ id: string }>(sql`
      WITH RECURSIVE t AS (
        SELECT id FROM doc_folders WHERE id IN (${sql.join(rootIds.map((i) => sql`${i}::uuid`), sql`, `)}) AND owner_user_id = ${ownerId} AND deleted_at IS NULL
        UNION
        SELECT f.id FROM doc_folders f JOIN t ON f.parent_id = t.id WHERE f.deleted_at IS NULL
      ) SELECT id FROM t`);
    return (r.rows as { id: string }[]).map((x) => x.id);
  }

  async createFolder(ownerId: string, name: string, parentId: string | null, byAgentId: string | null = null) {
    if (parentId) await this.folder(ownerId, parentId);
    const n = cleanName(name, 'New folder');
    const [dup] = await this.db
      .select({ id: docFolders.id })
      .from(docFolders)
      .where(and(eq(docFolders.ownerUserId, ownerId), parentId ? eq(docFolders.parentId, parentId) : isNull(docFolders.parentId), sql`lower(${docFolders.name}) = lower(${n})`, isNull(docFolders.deletedAt)));
    if (dup) throw new AppError(409, 'name_taken', 'A folder with this name already exists here.');
    const [f] = await this.db.insert(docFolders).values({ ownerUserId: ownerId, name: n, parentId }).returning();
    await this.audit.system({ action: byAgentId ? 'agent.folder_created' : 'documents.folder_created', targetType: 'doc_folder', targetId: f.id, subjectUserId: ownerId, metadata: { agentId: byAgentId } });
    return f;
  }

  async renameFolder(ownerId: string, id: string, name: string) {
    await this.folder(ownerId, id);
    const [f] = await this.db.update(docFolders).set({ name: cleanName(name, 'Folder') }).where(eq(docFolders.id, id)).returning();
    return f;
  }

  async moveFolder(ownerId: string, id: string, parentId: string | null) {
    await this.folder(ownerId, id);
    if (parentId) {
      await this.folder(ownerId, parentId);
      const inside = await this.subtree(ownerId, [id]);
      if (inside.includes(parentId)) throw badRequest('A folder cannot be moved inside itself.', 'invalid_move');
    }
    const [f] = await this.db.update(docFolders).set({ parentId }).where(eq(docFolders.id, id)).returning();
    return f;
  }

  /** Moves the folder, everything inside it, and its files to the bin together. */
  async binFolder(ownerId: string, id: string) {
    await this.folder(ownerId, id);
    const ids = await this.subtree(ownerId, [id]);
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx.update(docFiles).set({ deletedAt: now }).where(and(inArray(docFiles.folderId, ids), isNull(docFiles.deletedAt)));
      await tx.update(docFolders).set({ deletedAt: now }).where(inArray(docFolders.id, ids));
    });
  }

  async restoreFolder(ownerId: string, id: string) {
    const [f] = await this.db.select().from(docFolders).where(and(eq(docFolders.id, id), eq(docFolders.ownerUserId, ownerId), isNotNull(docFolders.deletedAt)));
    if (!f) throw notFound('Folder');
    if (f.parentId) {
      const [p] = await this.db.select({ d: docFolders.deletedAt }).from(docFolders).where(eq(docFolders.id, f.parentId));
      if (p?.d) throw new AppError(409, 'parent_in_bin', 'Restore the folder it was in first.');
    }
    const at = f.deletedAt!;
    // Restore what was binned at the same moment (the folder's contents).
    await this.db.transaction(async (tx) => {
      const r = await tx.execute<{ id: string }>(sql`
        WITH RECURSIVE t AS (
          SELECT id FROM doc_folders WHERE id = ${id}::uuid
          UNION SELECT c.id FROM doc_folders c JOIN t ON c.parent_id = t.id WHERE c.deleted_at = ${at}
        ) SELECT id FROM t`);
      const ids = (r.rows as { id: string }[]).map((x) => x.id);
      await tx.update(docFolders).set({ deletedAt: null }).where(inArray(docFolders.id, ids));
      await tx.update(docFiles).set({ deletedAt: null }).where(and(inArray(docFiles.folderId, ids), eq(docFiles.deletedAt, at)));
    });
    return this.folder(ownerId, id);
  }

  // ------------------------------------------------------------ files
  async file(ownerId: string, id: string) {
    const [f] = await this.db.select().from(docFiles).where(and(eq(docFiles.id, id), eq(docFiles.ownerUserId, ownerId), isNull(docFiles.deletedAt)));
    if (!f) throw notFound('File');
    return f;
  }

  async listFiles(ownerId: string, folderIds: string[]) {
    if (!folderIds.length) return [];
    return this.db
      .select()
      .from(docFiles)
      .where(and(eq(docFiles.ownerUserId, ownerId), inArray(docFiles.folderId, folderIds), isNull(docFiles.deletedAt)))
      .orderBy(asc(docFiles.name));
  }

  private async uniqueName(folderId: string, wanted: string, exceptId?: string) {
    const rows = await this.db.select({ id: docFiles.id, name: docFiles.name }).from(docFiles).where(and(eq(docFiles.folderId, folderId), isNull(docFiles.deletedAt)));
    const taken = new Set(rows.filter((r) => r.id !== exceptId).map((r) => r.name.toLowerCase()));
    if (!taken.has(wanted.toLowerCase())) return wanted;
    const dot = wanted.lastIndexOf('.');
    const [base, e] = dot > 0 ? [wanted.slice(0, dot), wanted.slice(dot)] : [wanted, ''];
    for (let i = 2; i < 1000; i++) {
      const n = `${base} (${i})${e}`;
      if (!taken.has(n.toLowerCase())) return n;
    }
    return `${base} ${uuidv7().slice(-6)}${e}`;
  }

  async upload(actor: Actor, folderId: string, file: { buffer: Buffer; originalname?: string; size: number } | undefined) {
    if (!file?.buffer?.length) throw new AppError(400, 'file_required', 'Choose a file to upload.');
    if (file.size > this.env.DOCUMENT_MAX_BYTES) {
      throw new AppError(HttpStatus.PAYLOAD_TOO_LARGE, 'file_too_large', `Files must be under ${Math.round(this.env.DOCUMENT_MAX_BYTES / 1024 / 1024)} MB.`);
    }
    await this.folder(actor.userId, folderId);
    // multer gives latin1-decoded names; recover UTF-8 (e.g. Hindi file names).
    const original = Buffer.from(file.originalname ?? 'file', 'latin1').toString('utf8');
    const name = cleanName(original, 'file');
    const mime = detectDocType(file.buffer, name);
    if (!mime) throw new AppError(HttpStatus.UNSUPPORTED_MEDIA_TYPE, 'file_type_not_allowed', 'Allowed: PDF, images, Word/Excel/PowerPoint and text files.');
    return this.store(actor.userId, folderId, name, file.buffer, mime, null);
  }

  async store(ownerId: string, folderId: string, name: string, buf: Buffer, mime: string, byAgentId: string | null) {
    const id = uuidv7();
    const key = `documents/${ownerId}/${id}`;
    await this.storage.put(key, buf, mime);
    const text = TEXT_TYPES.has(mime) ? buf.toString('utf8').slice(0, this.env.DOCUMENT_TEXT_MAX_CHARS) : null;
    const [row] = await this.db
      .insert(docFiles)
      .values({
        id,
        ownerUserId: ownerId,
        folderId,
        name: await this.uniqueName(folderId, name),
        mimeType: mime,
        sizeBytes: buf.length,
        storageKey: key,
        sha256: this.crypto.sha256(buf),
        textContent: text,
        lastChangedByAgentId: byAgentId,
      })
      .returning();
    await this.audit.system({ action: byAgentId ? 'agent.file_created' : 'documents.file_uploaded', targetType: 'doc_file', targetId: row.id, subjectUserId: ownerId, metadata: { agentId: byAgentId } });
    return row;
  }

  async createTextFile(ownerId: string, folderId: string, name: string, content: string, byAgentId: string | null = null) {
    await this.folder(ownerId, folderId);
    let n = cleanName(name, 'Note.txt');
    if (!/\.(txt|md|csv|json)$/i.test(n)) n += '.md';
    const mime = TEXT[ext(n)] ?? 'text/plain';
    return this.store(ownerId, folderId, n, Buffer.from(content, 'utf8'), mime, byAgentId);
  }

  /** Replace the text of a text file (keeps the same file id). */
  async writeText(ownerId: string, id: string, content: string, byAgentId: string | null = null) {
    const f = await this.file(ownerId, id);
    if (!TEXT_TYPES.has(f.mimeType)) throw new AppError(409, 'not_text', 'Only text files can be edited here.');
    const buf = Buffer.from(content, 'utf8');
    if (buf.length > this.env.DOCUMENT_MAX_BYTES) throw new AppError(HttpStatus.PAYLOAD_TOO_LARGE, 'file_too_large', 'Text is too long.');
    await this.storage.put(f.storageKey, buf, f.mimeType);
    const [row] = await this.db
      .update(docFiles)
      .set({ textContent: content.slice(0, this.env.DOCUMENT_TEXT_MAX_CHARS), sizeBytes: buf.length, sha256: this.crypto.sha256(buf), lastChangedByAgentId: byAgentId })
      .where(eq(docFiles.id, id))
      .returning();
    return row;
  }

  async renameFile(ownerId: string, id: string, name: string, byAgentId: string | null = null) {
    const f = await this.file(ownerId, id);
    let n = cleanName(name, f.name);
    // Keep the extension so the file still opens.
    const oldExt = ext(f.name);
    if (oldExt && ext(n) !== oldExt) n = `${n}.${oldExt}`;
    const [row] = await this.db
      .update(docFiles)
      .set({ name: await this.uniqueName(f.folderId, n, f.id), lastChangedByAgentId: byAgentId })
      .where(eq(docFiles.id, id))
      .returning();
    return row;
  }

  async moveFile(ownerId: string, id: string, folderId: string, byAgentId: string | null = null) {
    const f = await this.file(ownerId, id);
    await this.folder(ownerId, folderId);
    const [row] = await this.db
      .update(docFiles)
      .set({ folderId, name: await this.uniqueName(folderId, f.name, f.id), lastChangedByAgentId: byAgentId })
      .where(eq(docFiles.id, id))
      .returning();
    return row;
  }

  async binFile(ownerId: string, id: string, byAgentId: string | null = null) {
    await this.file(ownerId, id);
    await this.db.update(docFiles).set({ deletedAt: new Date(), lastChangedByAgentId: byAgentId }).where(eq(docFiles.id, id));
    await this.audit.system({ action: byAgentId ? 'agent.file_binned' : 'documents.file_binned', targetType: 'doc_file', targetId: id, subjectUserId: ownerId, metadata: { agentId: byAgentId } });
  }

  async restoreFile(ownerId: string, id: string) {
    const [f] = await this.db.select().from(docFiles).where(and(eq(docFiles.id, id), eq(docFiles.ownerUserId, ownerId), isNotNull(docFiles.deletedAt)));
    if (!f) throw notFound('File');
    const [folder] = await this.db.select({ d: docFolders.deletedAt }).from(docFolders).where(eq(docFolders.id, f.folderId));
    if (folder?.d) throw new AppError(409, 'parent_in_bin', 'Restore the folder it was in first.');
    const [row] = await this.db.update(docFiles).set({ deletedAt: null, name: await this.uniqueName(f.folderId, f.name, f.id) }).where(eq(docFiles.id, id)).returning();
    return row;
  }

  async bin(actor: Actor) {
    const files = await this.db
      .select()
      .from(docFiles)
      .where(and(eq(docFiles.ownerUserId, actor.userId), isNotNull(docFiles.deletedAt)))
      .orderBy(sql`${docFiles.deletedAt} desc`)
      .limit(200);
    const folders = await this.db
      .select()
      .from(docFolders)
      .where(and(eq(docFolders.ownerUserId, actor.userId), isNotNull(docFolders.deletedAt)))
      .orderBy(sql`${docFolders.deletedAt} desc`)
      .limit(200);
    // Only show top-level binned folders (their contents come back with them).
    const binnedIds = new Set(folders.map((f) => f.id));
    return {
      folders: folders.filter((f) => !f.parentId || !binnedIds.has(f.parentId)).map((f) => this.folderOut(f)),
      files: files.filter((f) => !binnedIds.has(f.folderId)).map((f) => this.fileOut(f)),
      purgeAfterDays: this.env.SOFT_DELETE_PURGE_DAYS,
    };
  }

  async sendFile(actor: Actor, id: string, res: Response, inline = false) {
    const f = await this.file(actor.userId, id);
    const url = await this.storage.signedUrl(f.storageKey, f.name);
    if (url && !inline) {
      res.redirect(302, url);
      return;
    }
    const safeInline = inline && (f.mimeType.startsWith('image/') || f.mimeType === 'application/pdf' || TEXT_TYPES.has(f.mimeType));
    res.setHeader('Content-Type', TEXT_TYPES.has(f.mimeType) ? `${f.mimeType}; charset=utf-8` : f.mimeType);
    res.setHeader('Content-Length', String(f.sizeBytes));
    res.setHeader('Content-Disposition', `${safeInline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=60');
    // Browsers' PDF viewers don't run inside a sandbox; everything else is locked down fully.
    res.setHeader('Content-Security-Policy', f.mimeType === 'application/pdf' ? "default-src 'none'; frame-ancestors 'self'" : "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
    (await this.storage.getStream(f.storageKey)).pipe(res);
  }

  /** Worker: permanently remove binned files and folders after the grace period. */
  async purgeBin(cutoff: Date) {
    const old = await this.db
      .select({ id: docFiles.id, key: docFiles.storageKey })
      .from(docFiles)
      .where(and(isNotNull(docFiles.deletedAt), sql`${docFiles.deletedAt} < ${cutoff}`))
      .limit(1000);
    for (const f of old) await this.storage.delete(f.key).catch(() => undefined);
    if (old.length) await this.db.delete(docFiles).where(inArray(docFiles.id, old.map((f) => f.id)));
    // Folders: only once nothing inside is still in use.
    const folders = await this.db.execute<{ id: string }>(sql`
      DELETE FROM doc_folders d WHERE d.deleted_at IS NOT NULL AND d.deleted_at < ${cutoff}
        AND NOT EXISTS (SELECT 1 FROM doc_files f WHERE f.folder_id = d.id)
        AND NOT EXISTS (SELECT 1 FROM doc_folders c WHERE c.parent_id = d.id)
      RETURNING d.id`);
    return old.length + (folders.rows?.length ?? 0);
  }

  /** Account deletion: remove stored file bodies (rows go with the user). */
  async deleteAllStored(ownerId: string) {
    const files = await this.db.select({ key: docFiles.storageKey }).from(docFiles).where(eq(docFiles.ownerUserId, ownerId));
    for (const f of files) await this.storage.delete(f.key).catch(() => undefined);
  }
}
