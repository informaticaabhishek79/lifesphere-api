import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import type { Response } from 'express';
import { StorageAdapter } from '../../adapters/storage';
import { Actor } from '../../common/auth-context';
import { CryptoService } from '../../common/crypto.service';
import { AppError, notFound } from '../../common/errors';
import { uuidv7 } from '../../common/ids';
import { PolicyService } from '../../common/policy.service';
import { addDays } from '../../common/time';
import { Env, ENV } from '../../config/env';
import { Database, DB } from '../../db/db';
import { attachments, posts, postAttachments, taskAttachments, tasks } from '../../db/schema';

export type AttachmentPurpose = 'task' | 'post' | 'consumer_case' | 'inventory' | 'avatar' | 'provider' | 'civic';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const ALLOWED: Record<AttachmentPurpose, string[]> = {
  avatar: IMAGE_TYPES,
  post: IMAGE_TYPES,
  civic: IMAGE_TYPES,
  provider: IMAGE_TYPES,
  task: [...IMAGE_TYPES, 'application/pdf'],
  inventory: [...IMAGE_TYPES, 'application/pdf'],
  consumer_case: [...IMAGE_TYPES, 'application/pdf'],
};

/** Detect type from the file's leading bytes; the client-declared type is not trusted. */
export function sniffMime(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  if (buf.length >= 5 && buf.subarray(0, 5).toString('ascii') === '%PDF-') return 'application/pdf';
  return null;
}

@Injectable()
export class AttachmentsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly storage: StorageAdapter,
    private readonly crypto: CryptoService,
    private readonly policy: PolicyService,
  ) {}

  async upload(actor: Actor, purpose: AttachmentPurpose, file: { buffer: Buffer; originalname?: string; size: number } | undefined) {
    if (!file?.buffer?.length) throw new AppError(400, 'file_required', 'Choose a file to upload.');
    if (file.size > this.env.UPLOAD_MAX_BYTES) {
      throw new AppError(HttpStatus.PAYLOAD_TOO_LARGE, 'file_too_large', `Files must be under ${Math.round(this.env.UPLOAD_MAX_BYTES / 1024 / 1024)} MB.`);
    }
    const mime = sniffMime(file.buffer);
    if (!mime || !ALLOWED[purpose].includes(mime)) {
      throw new AppError(HttpStatus.UNSUPPORTED_MEDIA_TYPE, 'file_type_not_allowed', `Allowed types: ${ALLOWED[purpose].join(', ')}`);
    }
    const id = uuidv7();
    const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }[mime];
    const key = `${purpose}/${actor.userId}/${id}.${ext}`;
    await this.storage.put(key, file.buffer, mime);
    // Consumer evidence is temporary by default (privacy): kept 30 days unless the user chooses to keep it.
    const temporary = purpose === 'consumer_case';
    const [row] = await this.db
      .insert(attachments)
      .values({
        id,
        ownerUserId: actor.userId,
        purpose,
        storageKey: key,
        originalName: (file.originalname ?? `upload.${ext}`).replace(/[^\w.\- ]/g, '_').slice(0, 200),
        mimeType: mime,
        sizeBytes: file.size,
        sha256: this.crypto.sha256(file.buffer),
        temporary,
        expiresAt: temporary ? addDays(new Date(), 30) : null,
      })
      .returning();
    return this.out(row);
  }

  out(a: typeof attachments.$inferSelect) {
    return {
      id: a.id,
      purpose: a.purpose,
      originalName: a.originalName,
      mimeType: a.mimeType,
      sizeBytes: a.sizeBytes,
      temporary: a.temporary,
      expiresAt: a.expiresAt,
      createdAt: a.createdAt,
    };
  }

  /** Owner-only lookup used when linking an attachment to a resource. */
  async requireOwned(userId: string, id: string, purposes: AttachmentPurpose[]) {
    const [a] = await this.db
      .select()
      .from(attachments)
      .where(and(eq(attachments.id, id), eq(attachments.ownerUserId, userId), eq(attachments.status, 'ready'), isNull(attachments.deletedAt)));
    if (!a || !purposes.includes(a.purpose as AttachmentPurpose)) throw notFound('Attachment');
    return a;
  }

  async canRead(actor: Actor, a: typeof attachments.$inferSelect): Promise<boolean> {
    if (a.ownerUserId === actor.userId) return true;
    if (a.purpose === 'avatar' || a.purpose === 'provider') return true;
    if (a.purpose === 'post' || a.purpose === 'civic') {
      const [link] = await this.db
        .select({ groupId: posts.groupId, status: posts.status })
        .from(postAttachments)
        .innerJoin(posts, eq(posts.id, postAttachments.postId))
        .where(eq(postAttachments.attachmentId, a.id))
        .limit(1);
      return !!link && link.status === 'published' && (await this.policy.canReadGroup(actor.userId, link.groupId));
    }
    if (a.purpose === 'task') {
      const [t] = await this.db
        .select({ id: tasks.id, ownerUserId: tasks.ownerUserId, householdId: tasks.householdId, visibility: tasks.visibility })
        .from(taskAttachments)
        .innerJoin(tasks, eq(tasks.id, taskAttachments.taskId))
        .where(eq(taskAttachments.attachmentId, a.id))
        .limit(1);
      return !!t && (await this.policy.canViewTask(actor.userId, t));
    }
    return false;
  }

  async get(actor: Actor, id: string) {
    const [a] = await this.db.select().from(attachments).where(and(eq(attachments.id, id), isNull(attachments.deletedAt)));
    if (!a || a.status !== 'ready' || !(await this.canRead(actor, a))) throw notFound('Attachment');
    return a;
  }

  async sendFile(actor: Actor, id: string, res: Response) {
    const a = await this.get(actor, id);
    const url = await this.storage.signedUrl(a.storageKey, a.originalName ?? 'file');
    if (url) {
      res.redirect(302, url);
      return;
    }
    res.setHeader('Content-Type', a.mimeType);
    res.setHeader('Content-Length', String(a.sizeBytes));
    res.setHeader('Content-Disposition', `${a.mimeType.startsWith('image/') ? 'inline' : 'attachment'}; filename="${(a.originalName ?? 'file').replace(/"/g, '')}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Security-Policy', "default-src 'none'");
    const stream = await this.storage.getStream(a.storageKey);
    stream.pipe(res);
  }

  async keep(actor: Actor, id: string) {
    const [a] = await this.db
      .update(attachments)
      .set({ temporary: false, expiresAt: null })
      .where(and(eq(attachments.id, id), eq(attachments.ownerUserId, actor.userId), isNull(attachments.deletedAt)))
      .returning();
    if (!a) throw notFound('Attachment');
    return this.out(a);
  }

  async remove(actor: Actor, id: string) {
    const [a] = await this.db
      .select()
      .from(attachments)
      .where(and(eq(attachments.id, id), eq(attachments.ownerUserId, actor.userId), isNull(attachments.deletedAt)));
    if (!a) throw notFound('Attachment');
    await this.hardDelete(a.id, a.storageKey);
  }

  async hardDelete(id: string, key: string) {
    await this.storage.delete(key).catch(() => undefined);
    await this.db.delete(attachments).where(eq(attachments.id, id));
  }
}
