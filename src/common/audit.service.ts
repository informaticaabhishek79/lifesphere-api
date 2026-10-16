import { Inject, Injectable } from '@nestjs/common';
import { Database, DB, DbOrTx } from '../db/db';
import { auditEvents } from '../db/schema';
import { Actor } from './auth-context';

export interface AuditInput {
  action: string;
  targetType?: string;
  targetId?: string | null;
  subjectUserId?: string | null;
  /** Identifiers, enums, counts only. Never free text, names, phone numbers or content. */
  metadata?: Record<string, string | number | boolean | null>;
  /** Set when the action was taken through a staff/admin endpoint. */
  asStaff?: boolean;
}

@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async record(actor: Actor | null, input: AuditInput, tx: DbOrTx = this.db) {
    await tx.insert(auditEvents).values({
      actorId: actor?.userId ?? null,
      actorType: !actor ? 'system' : input.asStaff ? 'staff' : 'user',
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      subjectUserId: input.subjectUserId ?? null,
      ipHash: actor?.ipHash ?? null,
      metadata: input.metadata ?? {},
    });
  }

  async system(input: AuditInput, tx: DbOrTx = this.db) {
    return this.record(null, input, tx);
  }
}
