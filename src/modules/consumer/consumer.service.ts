import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { AiAdapter } from '../../adapters/ai';
import { countryName, forCountry, languageName } from '../../common/countries';
import { AuditService } from '../../common/audit.service';
import { Actor } from '../../common/auth-context';
import { AppError, badRequest, notFound, unprocessable } from '../../common/errors';
import { keyset, lim, pageOf, CursorQuery } from '../../common/pagination';
import { addDays, toDateString } from '../../common/time';
import { Database, DB } from '../../db/db';
import {
  attachments,
  caseAttachments,
  complaintDrafts,
  consumerCaseEvents,
  consumerCases,
  homeInventoryItems,
  officialChannels,
  purchases,
  userPreferences,
  userProfiles,
} from '../../db/schema';
import { AttachmentsService } from '../attachments/attachments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PolicyService } from '../../common/policy.service';

type CaseStatus = 'draft' | 'ready_to_submit' | 'submitted_by_user' | 'awaiting_response' | 'info_required' | 'resolved' | 'closed';

/** Allowed status transitions. The platform never submits on the user's behalf; "submitted_by_user" is the user's statement. */
const TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  draft: ['ready_to_submit', 'closed'],
  ready_to_submit: ['draft', 'submitted_by_user', 'closed'],
  submitted_by_user: ['awaiting_response', 'info_required', 'resolved', 'closed'],
  awaiting_response: ['info_required', 'resolved', 'closed'],
  info_required: ['awaiting_response', 'submitted_by_user', 'resolved', 'closed'],
  resolved: ['closed', 'awaiting_response'],
  closed: ['draft'],
};

export interface PurchaseInput {
  productCategory?: string;
  brand?: string;
  model?: string;
  purchaseDate?: string;
  retailerName?: string;
  warrantyExpiresOn?: string;
  returnDeadline?: string;
  serviceReference?: string;
  notes?: string;
  inventoryItemId?: string | null;
  householdId?: string | null;
}

export interface CaseInput {
  title?: string;
  counterpartyName?: string;
  category?: string;
  purchaseId?: string | null;
  officialChannelId?: string | null;
  nextFollowUpOn?: string | null;
  resolutionNote?: string;
}

@Injectable()
export class ConsumerService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly ai: AiAdapter,
    private readonly attachmentsSvc: AttachmentsService,
    private readonly notifications: NotificationsService,
    private readonly policy: PolicyService,
  ) {}

  // ------------------------------------------------------------------ purchases & warranties
  async purchases(actor: Actor, q: { expiringWithinDays?: number }) {
    return this.db
      .select()
      .from(purchases)
      .where(
        and(
          eq(purchases.ownerUserId, actor.userId),
          isNull(purchases.deletedAt),
          q.expiringWithinDays !== undefined ? lte(purchases.warrantyExpiresOn, toDateString(addDays(new Date(), q.expiringWithinDays))) : undefined,
        ),
      )
      .orderBy(asc(purchases.warrantyExpiresOn), desc(purchases.createdAt))
      .limit(500);
  }

  private async checkLinks(actor: Actor, dto: PurchaseInput) {
    if (dto.inventoryItemId) {
      const [i] = await this.db.select().from(homeInventoryItems).where(and(eq(homeInventoryItems.id, dto.inventoryItemId), isNull(homeInventoryItems.deletedAt)));
      const ok = i && (i.ownerUserId === actor.userId || (i.householdId && (await this.policy.householdRole(actor.userId, i.householdId))));
      if (!ok) throw notFound('Inventory item');
    }
    if (dto.householdId) await this.policy.requireHouseholdMember(actor.userId, dto.householdId);
  }

  async createPurchase(actor: Actor, dto: PurchaseInput & { productCategory: string }) {
    await this.checkLinks(actor, dto);
    const [p] = await this.db.insert(purchases).values({ ownerUserId: actor.userId, ...dto }).returning();
    return p;
  }

  private async purchase(actor: Actor, id: string) {
    const [p] = await this.db.select().from(purchases).where(and(eq(purchases.id, id), eq(purchases.ownerUserId, actor.userId), isNull(purchases.deletedAt)));
    if (!p) throw notFound('Purchase');
    return p;
  }

  async getPurchase(actor: Actor, id: string) {
    const p = await this.purchase(actor, id);
    const cases = await this.db.select({ id: consumerCases.id, title: consumerCases.title, status: consumerCases.status }).from(consumerCases).where(and(eq(consumerCases.purchaseId, id), isNull(consumerCases.deletedAt)));
    return { ...p, cases };
  }

  async updatePurchase(actor: Actor, id: string, dto: PurchaseInput) {
    await this.purchase(actor, id);
    await this.checkLinks(actor, dto);
    const [p] = await this.db.update(purchases).set(dto).where(eq(purchases.id, id)).returning();
    return p;
  }

  async deletePurchase(actor: Actor, id: string) {
    await this.purchase(actor, id);
    await this.db.update(purchases).set({ deletedAt: new Date() }).where(eq(purchases.id, id));
  }

  // ------------------------------------------------------------------ cases
  async cases(actor: Actor, q: CursorQuery & { status?: string }) {
    const limit = lim(q);
    const rows = await this.db
      .select()
      .from(consumerCases)
      .where(
        and(
          eq(consumerCases.ownerUserId, actor.userId),
          isNull(consumerCases.deletedAt),
          q.status ? eq(consumerCases.status, q.status as CaseStatus) : undefined,
          keyset(consumerCases.updatedAt, consumerCases.id, q.cursor),
        ),
      )
      .orderBy(desc(consumerCases.updatedAt), desc(consumerCases.id))
      .limit(limit + 1);
    return pageOf(rows, limit, (r) => [r.updatedAt, r.id]);
  }

  private async checkCaseLinks(actor: Actor, dto: CaseInput) {
    if (dto.purchaseId) await this.purchase(actor, dto.purchaseId);
    if (dto.officialChannelId) {
      const [c] = await this.db.select({ id: officialChannels.id }).from(officialChannels).where(and(eq(officialChannels.id, dto.officialChannelId), eq(officialChannels.active, true)));
      if (!c) throw notFound('Official channel');
    }
  }

  async createCase(actor: Actor, dto: CaseInput & { title: string; description?: string }) {
    await this.checkCaseLinks(actor, dto);
    const { description, ...fields } = dto;
    const [c] = await this.db.insert(consumerCases).values({ ownerUserId: actor.userId, ...fields }).returning();
    if (description) {
      await this.db.insert(consumerCaseEvents).values({ caseId: c.id, kind: 'note', occurredOn: toDateString(new Date()), description });
    }
    return this.getCase(actor, c.id);
  }

  private async case(actor: Actor, id: string) {
    const [c] = await this.db.select().from(consumerCases).where(and(eq(consumerCases.id, id), eq(consumerCases.ownerUserId, actor.userId), isNull(consumerCases.deletedAt)));
    if (!c) throw notFound('Case');
    return c;
  }

  async getCase(actor: Actor, id: string) {
    const c = await this.case(actor, id);
    const timeline = await this.db.select().from(consumerCaseEvents).where(eq(consumerCaseEvents.caseId, id)).orderBy(asc(consumerCaseEvents.occurredOn), asc(consumerCaseEvents.createdAt));
    const drafts = await this.db.select().from(complaintDrafts).where(eq(complaintDrafts.caseId, id)).orderBy(desc(complaintDrafts.createdAt));
    const files = await this.db
      .select({ id: attachments.id, originalName: attachments.originalName, mimeType: attachments.mimeType, temporary: attachments.temporary, expiresAt: attachments.expiresAt })
      .from(caseAttachments)
      .innerJoin(attachments, eq(attachments.id, caseAttachments.attachmentId))
      .where(eq(caseAttachments.caseId, id));
    const [channel] = c.officialChannelId ? await this.db.select().from(officialChannels).where(eq(officialChannels.id, c.officialChannelId)) : [];
    return { ...c, allowedNextStatuses: TRANSITIONS[c.status], timeline, drafts, attachments: files, officialChannel: channel ?? null };
  }

  async updateCase(actor: Actor, id: string, dto: CaseInput) {
    await this.case(actor, id);
    await this.checkCaseLinks(actor, dto);
    const [c] = await this.db.update(consumerCases).set(dto).where(eq(consumerCases.id, id)).returning();
    return c;
  }

  /**
   * Move a case through its workflow. Marking it submitted requires an approved draft (or explicit confirmation that
   * the user submitted their own text), and any reference number is exactly what the user entered.
   */
  async setStatus(actor: Actor, id: string, dto: { status: CaseStatus; externalReference?: string; note?: string; confirmSubmittedMyself?: boolean }) {
    const c = await this.case(actor, id);
    if (!TRANSITIONS[c.status].includes(dto.status)) {
      throw unprocessable(`Cannot move from ${c.status} to ${dto.status}`, 'invalid_transition');
    }
    if (dto.status === 'submitted_by_user') {
      const [approved] = await this.db.select({ id: complaintDrafts.id }).from(complaintDrafts).where(and(eq(complaintDrafts.caseId, id), sql`${complaintDrafts.approvedAt} is not null`)).limit(1);
      if (!approved && !dto.confirmSubmittedMyself) {
        throw new AppError(422, 'approval_required', 'Approve a draft first, or confirm you submitted the complaint yourself (confirmSubmittedMyself: true).');
      }
    }
    const [u] = await this.db
      .update(consumerCases)
      .set({
        status: dto.status,
        ...(dto.externalReference !== undefined ? { externalReference: dto.externalReference } : {}),
        ...(dto.status === 'submitted_by_user' ? { submittedAt: new Date(), nextFollowUpOn: c.nextFollowUpOn ?? toDateString(addDays(new Date(), 15)) } : {}),
        ...(dto.status === 'resolved' && dto.note ? { resolutionNote: dto.note } : {}),
      })
      .where(eq(consumerCases.id, id))
      .returning();
    await this.db.insert(consumerCaseEvents).values({
      caseId: id,
      kind: 'status_change',
      occurredOn: toDateString(new Date()),
      description: `Status: ${c.status} → ${dto.status}${dto.note ? ` — ${dto.note}` : ''}`.slice(0, 1000),
    });
    return u;
  }

  async deleteCase(actor: Actor, id: string) {
    await this.case(actor, id);
    const files = await this.db.select({ id: attachments.id, key: attachments.storageKey }).from(caseAttachments).innerJoin(attachments, eq(attachments.id, caseAttachments.attachmentId)).where(eq(caseAttachments.caseId, id));
    for (const f of files) await this.attachmentsSvc.hardDelete(f.id, f.key);
    await this.db.update(consumerCases).set({ deletedAt: new Date() }).where(eq(consumerCases.id, id));
  }

  async addEvent(actor: Actor, id: string, dto: { kind: 'note' | 'contact' | 'response' | 'follow_up'; occurredOn: string; description: string }) {
    await this.case(actor, id);
    const [e] = await this.db.insert(consumerCaseEvents).values({ caseId: id, ...dto }).returning();
    await this.db.update(consumerCases).set({ updatedAt: new Date() }).where(eq(consumerCases.id, id));
    return e;
  }

  async deleteEvent(actor: Actor, id: string, eventId: string) {
    await this.case(actor, id);
    const res = await this.db.delete(consumerCaseEvents).where(and(eq(consumerCaseEvents.id, eventId), eq(consumerCaseEvents.caseId, id), sql`${consumerCaseEvents.kind} <> 'status_change'`)).returning();
    if (!res.length) throw notFound('Timeline entry');
  }

  async attach(actor: Actor, id: string, attachmentId: string) {
    await this.case(actor, id);
    await this.attachmentsSvc.requireOwned(actor.userId, attachmentId, ['consumer_case']);
    await this.db.insert(caseAttachments).values({ caseId: id, attachmentId }).onConflictDoNothing();
    return { caseId: id, attachmentId };
  }

  async detach(actor: Actor, id: string, attachmentId: string) {
    await this.case(actor, id);
    const res = await this.db.delete(caseAttachments).where(and(eq(caseAttachments.caseId, id), eq(caseAttachments.attachmentId, attachmentId))).returning();
    if (!res.length) throw notFound('Attachment');
  }

  // ------------------------------------------------------------------ drafts
  async saveDraft(actor: Actor, id: string, body: string) {
    await this.case(actor, id);
    const [d] = await this.db.insert(complaintDrafts).values({ caseId: id, body, source: 'user' }).returning();
    return d;
  }

  /**
   * AI drafts a complaint ONLY from details the user provides in this request plus the case's own timeline.
   * It is told not to invent facts, reference numbers or legal citations. The user must review and approve it.
   */
  async generateDraft(actor: Actor, id: string, details: { whatHappened: string; whatYouWant: string; includeTimeline?: boolean; tone?: 'polite' | 'firm' }) {
    const c = await this.case(actor, id);
    const [prefs] = await this.db.select({ ai: userPreferences.aiEnabled }).from(userPreferences).where(eq(userPreferences.userId, actor.userId));
    if (prefs && !prefs.ai) throw new AppError(409, 'assistant_disabled', 'The assistant is turned off in your settings.');
    const timeline = details.includeTimeline === false ? [] : await this.db.select().from(consumerCaseEvents).where(eq(consumerCaseEvents.caseId, id)).orderBy(asc(consumerCaseEvents.occurredOn));
    const [p] = c.purchaseId ? await this.db.select().from(purchases).where(eq(purchases.id, c.purchaseId)) : [];
    const facts = [
      `Complaint about: ${c.title}`,
      c.counterpartyName ? `Company/seller: ${c.counterpartyName}` : null,
      p ? `Product: ${[p.productCategory, p.brand, p.model].filter(Boolean).join(' ')}; purchased ${p.purchaseDate ?? 'date not given'} from ${p.retailerName ?? 'retailer not given'}; warranty until ${p.warrantyExpiresOn ?? 'not given'}` : null,
      c.externalReference ? `Existing reference number (from user): ${c.externalReference}` : null,
      `What happened (user's words): ${details.whatHappened}`,
      `Resolution requested: ${details.whatYouWant}`,
      timeline.length ? `Timeline:\n${timeline.map((t) => `- ${t.occurredOn}: ${t.description}`).join('\n')}` : null,
    ]
      .filter(Boolean)
      .join('\n');
    const [who] = await this.db.select({ country: userProfiles.country, locale: userProfiles.locale }).from(userProfiles).where(eq(userProfiles.userId, actor.userId));
    const place = countryName(who?.country);
    const system =
      `COMPLAINT_DRAFT. You help a consumer${place ? ` in ${place}` : ''} write a clear complaint letter in ${languageName(who?.locale)}. Use ONLY the facts provided. ` +
      'Do not invent dates, amounts, reference numbers, laws, legal sections, case citations or promises. ' +
      'Where a fact is missing, write a placeholder in square brackets like [order number]. ' +
      `Tone: ${details.tone ?? 'polite'} but clear. Output only the letter text.`;
    const out = await this.ai.complete(system, [{ role: 'user', content: facts }], 900);
    const [d] = await this.db.insert(complaintDrafts).values({ caseId: id, body: out.text, source: 'ai', aiModel: out.model }).returning();
    return { ...d, simulated: out.simulated, notice: 'Review and edit this draft. It is not sent anywhere. Approve it before marking the complaint as submitted.' };
  }

  async updateDraft(actor: Actor, id: string, draftId: string, body: string) {
    await this.case(actor, id);
    const [d] = await this.db.update(complaintDrafts).set({ body, approvedAt: null }).where(and(eq(complaintDrafts.id, draftId), eq(complaintDrafts.caseId, id))).returning();
    if (!d) throw notFound('Draft');
    return d;
  }

  async approveDraft(actor: Actor, id: string, draftId: string) {
    const c = await this.case(actor, id);
    const [d] = await this.db.update(complaintDrafts).set({ approvedAt: new Date() }).where(and(eq(complaintDrafts.id, draftId), eq(complaintDrafts.caseId, id))).returning();
    if (!d) throw notFound('Draft');
    if (c.status === 'draft') await this.db.update(consumerCases).set({ status: 'ready_to_submit' }).where(eq(consumerCases.id, id));
    return d;
  }

  async deleteDraft(actor: Actor, id: string, draftId: string) {
    await this.case(actor, id);
    const res = await this.db.delete(complaintDrafts).where(and(eq(complaintDrafts.id, draftId), eq(complaintDrafts.caseId, id))).returning();
    if (!res.length) throw notFound('Draft');
  }

  /** Evidence checklist: general guidance, not legal advice. */
  checklist(category?: string) {
    const base = [
      'Invoice or order confirmation (you can note the number instead of uploading)',
      'Dates: purchase, problem noticed, each time you contacted the seller',
      'Names of people you spoke to and any ticket or reference numbers they gave you',
      'Photos of the defect or damage, if relevant',
      "Copies or screenshots of the seller's replies",
      'What you want: repair, replacement, refund or other',
    ];
    const extra: Record<string, string[]> = {
      ecommerce: ['Order ID and delivery date', 'Return/refund request ID if you raised one in the app'],
      telecom: ['Account or mobile number concerned (keep it in your own notes)', 'Docket number from the operator'],
      banking: ['Do not upload statements. Note dates and transaction reference only.'],
      appliance: ['Warranty card details (expiry date) and service visit dates'],
    };
    return {
      items: [...base, ...(category && extra[category] ? extra[category] : [])],
      disclaimer: 'General information, not legal advice. For legal advice consult a qualified professional.',
    };
  }

  countryOf(userId: string) {
    return this.policy.countryOf(userId);
  }

  async officialChannels(kind?: string, topic?: string, country?: string | null) {
    return this.db
      .select()
      .from(officialChannels)
      .where(
        and(
          eq(officialChannels.active, true),
          kind ? eq(officialChannels.kind, kind as 'consumer') : undefined,
          topic ? sql`${topic} = any(${officialChannels.topics})` : undefined,
          forCountry(officialChannels.country, country),
        ),
      )
      .orderBy(asc(officialChannels.name));
  }

  /** Worker (daily): follow-up dates, warranty expiry (30 and 7 days) and return deadlines (2 days). */
  async dailyReminders() {
    const today = toDateString(new Date());
    const followUps = await this.db
      .select()
      .from(consumerCases)
      .where(and(eq(consumerCases.nextFollowUpOn, today), isNull(consumerCases.deletedAt), inArray(consumerCases.status, ['submitted_by_user', 'awaiting_response', 'info_required'])));
    for (const c of followUps) {
      await this.notifications.notify({ userId: c.ownerUserId, category: 'consumer', template: 'case_follow_up', title: `Follow up today: ${c.title}`, data: { type: 'consumer_case', id: c.id } });
    }
    const d30 = toDateString(addDays(new Date(), 30));
    const d7 = toDateString(addDays(new Date(), 7));
    const d2 = toDateString(addDays(new Date(), 2));
    const expiring = await this.db.select().from(purchases).where(and(isNull(purchases.deletedAt), inArray(purchases.warrantyExpiresOn, [d30, d7])));
    for (const p of expiring) {
      await this.notifications.notify({ userId: p.ownerUserId, category: 'consumer', template: 'warranty_expiring', title: `Warranty ends ${p.warrantyExpiresOn}: ${[p.brand, p.model, p.productCategory].filter(Boolean).join(' ')}`, data: { type: 'purchase', id: p.id } });
    }
    const returns = await this.db.select().from(purchases).where(and(isNull(purchases.deletedAt), eq(purchases.returnDeadline, d2)));
    for (const p of returns) {
      await this.notifications.notify({ userId: p.ownerUserId, category: 'consumer', template: 'return_deadline', title: `Return window closes ${p.returnDeadline}: ${[p.brand, p.model, p.productCategory].filter(Boolean).join(' ')}`, data: { type: 'purchase', id: p.id } });
    }
    return { followUps: followUps.length, warranties: expiring.length, returns: returns.length };
  }
}

void badRequest;
