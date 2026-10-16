import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { StorageAdapter } from '../../adapters/storage';
import { AuditService } from '../../common/audit.service';
import { Actor } from '../../common/auth-context';
import { CryptoService } from '../../common/crypto.service';
import { badRequest, conflict, notFound, unprocessable } from '../../common/errors';
import { JOBS, QueueService } from '../../common/queue.service';
import { addDays } from '../../common/time';
import { Env, ENV } from '../../config/env';
import { Database, DB } from '../../db/db';
import * as s from '../../db/schema';
import { NotificationsService } from '../notifications/notifications.service';

/** Consent purposes a user can grant or withdraw independently of registration. */
export const CONSENT_PURPOSES = [
  'terms',
  'privacy_notice',
  'location_help',
  'checkins_sharing',
  'ai_assistance',
  'email_updates',
  'community_participation',
] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

@Injectable()
export class PrivacyService {
  private readonly logger = new Logger('Privacy');

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
    private readonly queue: QueueService,
    private readonly storage: StorageAdapter,
    private readonly crypto: CryptoService,
    private readonly notifications: NotificationsService,
  ) {}

  // ------------------------------------------------------------------ consents
  async listConsents(userId: string) {
    return this.db
      .select({
        id: s.consentRecords.id,
        purpose: s.consentRecords.purpose,
        policyVersion: s.consentRecords.policyVersion,
        grantedAt: s.consentRecords.grantedAt,
        withdrawnAt: s.consentRecords.withdrawnAt,
      })
      .from(s.consentRecords)
      .where(eq(s.consentRecords.userId, userId))
      .orderBy(desc(s.consentRecords.grantedAt));
  }

  async hasConsent(userId: string, purpose: ConsentPurpose) {
    const [r] = await this.db
      .select({ id: s.consentRecords.id })
      .from(s.consentRecords)
      .where(and(eq(s.consentRecords.userId, userId), eq(s.consentRecords.purpose, purpose), isNull(s.consentRecords.withdrawnAt)))
      .limit(1);
    return !!r;
  }

  async grantConsent(actor: Actor, purpose: ConsentPurpose, policyVersion: string) {
    const [existing] = await this.db
      .select()
      .from(s.consentRecords)
      .where(and(eq(s.consentRecords.userId, actor.userId), eq(s.consentRecords.purpose, purpose), isNull(s.consentRecords.withdrawnAt)))
      .limit(1);
    if (existing && existing.policyVersion === policyVersion) return existing;
    if (existing) await this.db.update(s.consentRecords).set({ withdrawnAt: new Date() }).where(eq(s.consentRecords.id, existing.id));
    const [row] = await this.db.insert(s.consentRecords).values({ userId: actor.userId, purpose, policyVersion }).returning();
    await this.audit.record(actor, { action: 'consent.granted', targetType: 'consent', targetId: row.id, subjectUserId: actor.userId, metadata: { purpose, policyVersion } });
    return row;
  }

  /** Withdrawal has immediate effect on the features that depend on it. */
  async withdrawConsent(actor: Actor, purpose: ConsentPurpose) {
    if (purpose === 'terms' || purpose === 'privacy_notice') {
      throw conflict('These are needed to keep an account. To stop all processing, request account deletion instead.', 'consent_required_for_account');
    }
    const res = await this.db
      .update(s.consentRecords)
      .set({ withdrawnAt: new Date() })
      .where(and(eq(s.consentRecords.userId, actor.userId), eq(s.consentRecords.purpose, purpose), isNull(s.consentRecords.withdrawnAt)))
      .returning({ id: s.consentRecords.id });
    if (!res.length) throw notFound('Consent');
    const effects: string[] = [];
    if (purpose === 'location_help') {
      await this.db.update(s.emergencyContactPreferences).set({ shareLocationByDefault: false }).where(eq(s.emergencyContactPreferences.userId, actor.userId));
      await this.db
        .update(s.helpRequests)
        .set({ locationLat: null, locationLng: null, locationExpiresAt: null })
        .where(eq(s.helpRequests.userId, actor.userId));
      effects.push('Location will not be attached to help requests; stored help locations erased');
    }
    if (purpose === 'checkins_sharing') {
      await this.db.update(s.checkInSchedules).set({ escalate: false }).where(eq(s.checkInSchedules.userId, actor.userId));
      effects.push('Missed check-ins will no longer alert your contacts');
    }
    if (purpose === 'ai_assistance') {
      await this.db.update(s.userPreferences).set({ aiEnabled: false }).where(eq(s.userPreferences.userId, actor.userId));
      await this.db.delete(s.aiConversations).where(eq(s.aiConversations.userId, actor.userId));
      effects.push('Assistant turned off and conversation history deleted');
    }
    if (purpose === 'email_updates') {
      await this.db
        .update(s.notificationPreferences)
        .set({ email: false })
        .where(and(eq(s.notificationPreferences.userId, actor.userId), sql`${s.notificationPreferences.category} <> 'security'`));
      effects.push('Non-security emails stopped');
    }
    await this.audit.record(actor, { action: 'consent.withdrawn', targetType: 'consent', subjectUserId: actor.userId, metadata: { purpose } });
    return { purpose, withdrawn: true, effects };
  }

  // ------------------------------------------------------------------ requests
  async createRequest(actor: Actor, type: 'export' | 'delete' | 'correction' | 'grievance', details?: string) {
    const open = await this.db
      .select({ id: s.privacyRequests.id })
      .from(s.privacyRequests)
      .where(and(eq(s.privacyRequests.userId, actor.userId), eq(s.privacyRequests.type, type), inArray(s.privacyRequests.status, ['received', 'in_progress'])))
      .limit(1);
    if (open.length && (type === 'export' || type === 'delete')) throw conflict('You already have this request in progress.', 'request_in_progress');
    if ((type === 'correction' || type === 'grievance') && !details?.trim()) throw badRequest('Please describe your request', 'details_required');

    const dueAt = type === 'delete' ? addDays(new Date(), this.env.ACCOUNT_DELETION_GRACE_DAYS) : addDays(new Date(), this.env.PRIVACY_REQUEST_SLA_DAYS);
    const [req] = await this.db
      .insert(s.privacyRequests)
      .values({ userId: actor.userId, type, details: details?.slice(0, 4000), dueAt, status: type === 'delete' ? 'in_progress' : 'received' })
      .returning();

    if (type === 'export') {
      await this.queue.send(JOBS.privacyExport, { requestId: req.id }, { singletonKey: `export:${actor.userId}` });
    }
    if (type === 'delete') {
      await this.db.update(s.users).set({ status: 'pending_deletion', deletionRequestedAt: new Date() }).where(eq(s.users.id, actor.userId));
      await this.db
        .update(s.sessions)
        .set({ revokedAt: new Date(), revokedReason: 'account_deletion' })
        .where(and(eq(s.sessions.userId, actor.userId), isNull(s.sessions.revokedAt), sql`${s.sessions.id} <> ${actor.sessionId}`));
      await this.notifications.notify({
        userId: actor.userId,
        category: 'privacy',
        template: 'deletion_scheduled',
        title: 'Account deletion scheduled',
        body: `Your account and data will be permanently deleted on ${dueAt.toDateString()}. Sign in before then to cancel.`,
        channels: ['email'],
      });
    }
    await this.audit.record(actor, { action: `privacy.${type}_requested`, targetType: 'privacy_request', targetId: req.id, subjectUserId: actor.userId });
    return this.requestOut(req);
  }

  private requestOut(r: typeof s.privacyRequests.$inferSelect) {
    return {
      id: r.id,
      type: r.type,
      status: r.status,
      dueAt: r.dueAt,
      completedAt: r.completedAt,
      resolutionNote: r.resolutionNote,
      hasDownload: !!r.resultAttachmentId,
      createdAt: r.createdAt,
    };
  }

  async listRequests(userId: string) {
    const rows = await this.db.select().from(s.privacyRequests).where(eq(s.privacyRequests.userId, userId)).orderBy(desc(s.privacyRequests.createdAt));
    return rows.map((r) => this.requestOut(r));
  }

  async getRequest(userId: string, id: string) {
    const [r] = await this.db.select().from(s.privacyRequests).where(and(eq(s.privacyRequests.id, id), eq(s.privacyRequests.userId, userId)));
    if (!r) throw notFound('Privacy request');
    return r;
  }

  async cancelRequest(actor: Actor, id: string) {
    const r = await this.getRequest(actor.userId, id);
    if (!['received', 'in_progress'].includes(r.status)) throw unprocessable('This request can no longer be cancelled');
    await this.db.update(s.privacyRequests).set({ status: 'cancelled', completedAt: new Date() }).where(eq(s.privacyRequests.id, id));
    if (r.type === 'delete') {
      await this.db.update(s.users).set({ status: 'active', deletionRequestedAt: null }).where(eq(s.users.id, actor.userId));
    }
    await this.audit.record(actor, { action: `privacy.${r.type}_cancelled`, targetType: 'privacy_request', targetId: id, subjectUserId: actor.userId });
    return { id, status: 'cancelled' };
  }

  // ------------------------------------------------------------------ worker: export
  async runExport(requestId: string) {
    const [req] = await this.db.select().from(s.privacyRequests).where(eq(s.privacyRequests.id, requestId));
    if (!req || !req.userId || req.status === 'completed' || req.status === 'cancelled') return;
    await this.db.update(s.privacyRequests).set({ status: 'in_progress' }).where(eq(s.privacyRequests.id, requestId));
    const data = await this.collectUserData(req.userId);
    const buf = Buffer.from(JSON.stringify(data, null, 2), 'utf8');
    const key = `exports/${req.userId}/${requestId}.json`;
    await this.storage.put(key, buf, 'application/json');
    const [att] = await this.db
      .insert(s.attachments)
      .values({
        ownerUserId: req.userId,
        purpose: 'export',
        storageKey: key,
        originalName: `lifesphere-export-${new Date().toISOString().slice(0, 10)}.json`,
        mimeType: 'application/json',
        sizeBytes: buf.length,
        sha256: this.crypto.sha256(buf),
        temporary: true,
        expiresAt: addDays(new Date(), 7),
      })
      .returning({ id: s.attachments.id });
    await this.db
      .update(s.privacyRequests)
      .set({ status: 'completed', completedAt: new Date(), resultAttachmentId: att.id })
      .where(eq(s.privacyRequests.id, requestId));
    await this.notifications.notify({
      userId: req.userId,
      category: 'privacy',
      template: 'export_ready',
      title: 'Your data export is ready',
      body: 'Download it from Settings → Privacy within 7 days.',
      data: { type: 'privacy_request', id: requestId },
      channels: ['push', 'email'],
    });
    await this.audit.system({ action: 'privacy.export_completed', targetType: 'privacy_request', targetId: requestId, subjectUserId: req.userId });
  }

  async collectUserData(userId: string) {
    const q = async <T>(p: Promise<T>) => p;
    const [user] = await this.db
      .select({
        id: s.users.id,
        phone: s.users.phoneE164,
        email: s.users.email,
        phoneVerifiedAt: s.users.phoneVerifiedAt,
        emailVerifiedAt: s.users.emailVerifiedAt,
        status: s.users.status,
        createdAt: s.users.createdAt,
      })
      .from(s.users)
      .where(eq(s.users.id, userId));
    const tasks = await q(this.db.select().from(s.tasks).where(eq(s.tasks.ownerUserId, userId)));
    const taskIds = tasks.map((t) => t.id);
    const cases = await q(this.db.select().from(s.consumerCases).where(eq(s.consumerCases.ownerUserId, userId)));
    const caseIds = cases.map((c) => c.id);
    const lists = await q(this.db.select().from(s.shoppingLists).where(eq(s.shoppingLists.ownerUserId, userId)));
    const items = await q(this.db.select().from(s.homeInventoryItems).where(eq(s.homeInventoryItems.ownerUserId, userId)));
    const schedules = await q(this.db.select().from(s.checkInSchedules).where(eq(s.checkInSchedules.userId, userId)));
    const convs = await q(this.db.select().from(s.aiConversations).where(eq(s.aiConversations.userId, userId)));
    return {
      exportedAt: new Date().toISOString(),
      format: 'LifeSphere export v1',
      account: user,
      profile: await this.db.select().from(s.userProfiles).where(eq(s.userProfiles.userId, userId)),
      preferences: await this.db.select().from(s.userPreferences).where(eq(s.userPreferences.userId, userId)),
      notificationPreferences: await this.db.select().from(s.notificationPreferences).where(eq(s.notificationPreferences.userId, userId)),
      consents: await this.db.select().from(s.consentRecords).where(eq(s.consentRecords.userId, userId)),
      sessions: await this.db
        .select({ id: s.sessions.id, deviceName: s.sessions.deviceName, platform: s.sessions.platform, createdAt: s.sessions.createdAt, lastUsedAt: s.sessions.lastUsedAt, revokedAt: s.sessions.revokedAt })
        .from(s.sessions)
        .where(eq(s.sessions.userId, userId)),
      households: await this.db.select().from(s.householdMembers).where(eq(s.householdMembers.userId, userId)),
      tasks,
      taskAssignments: await this.db.select().from(s.taskAssignments).where(or(eq(s.taskAssignments.assigneeUserId, userId), eq(s.taskAssignments.assignedBy, userId))),
      taskCategories: await this.db.select().from(s.taskCategories).where(eq(s.taskCategories.ownerUserId, userId)),
      reminders: await this.db.select().from(s.reminders).where(eq(s.reminders.userId, userId)),
      calendarEvents: await this.db.select().from(s.calendarEvents).where(eq(s.calendarEvents.ownerUserId, userId)),
      shoppingLists: lists,
      shoppingListItems: lists.length
        ? await this.db.select().from(s.shoppingListItems).where(inArray(s.shoppingListItems.listId, lists.map((l) => l.id)))
        : [],
      homeInventory: items,
      maintenanceRecords: items.length
        ? await this.db.select().from(s.maintenanceRecords).where(inArray(s.maintenanceRecords.itemId, items.map((i) => i.id)))
        : [],
      budgets: await this.db.select().from(s.householdBudgets).where(eq(s.householdBudgets.ownerUserId, userId)),
      trustedContacts: await this.db.select().from(s.trustedContacts).where(or(eq(s.trustedContacts.userId, userId), eq(s.trustedContacts.contactUserId, userId))),
      accessGrants: await this.db.select().from(s.accessGrants).where(or(eq(s.accessGrants.grantorId, userId), eq(s.accessGrants.granteeId, userId))),
      checkInSchedules: schedules,
      checkInEvents: await this.db.select().from(s.checkInEvents).where(eq(s.checkInEvents.userId, userId)),
      emergencyPreferences: await this.db.select().from(s.emergencyContactPreferences).where(eq(s.emergencyContactPreferences.userId, userId)),
      helpRequests: await this.db.select().from(s.helpRequests).where(eq(s.helpRequests.userId, userId)),
      purchases: await this.db.select().from(s.purchases).where(eq(s.purchases.ownerUserId, userId)),
      consumerCases: cases,
      consumerCaseEvents: caseIds.length ? await this.db.select().from(s.consumerCaseEvents).where(inArray(s.consumerCaseEvents.caseId, caseIds)) : [],
      complaintDrafts: caseIds.length ? await this.db.select().from(s.complaintDrafts).where(inArray(s.complaintDrafts.caseId, caseIds)) : [],
      groupMemberships: await this.db.select().from(s.groupMemberships).where(eq(s.groupMemberships.userId, userId)),
      posts: await this.db.select().from(s.posts).where(eq(s.posts.authorId, userId)),
      comments: await this.db.select().from(s.comments).where(eq(s.comments.authorId, userId)),
      reactions: await this.db.select().from(s.reactions).where(eq(s.reactions.userId, userId)),
      bookmarks: await this.db.select().from(s.bookmarks).where(eq(s.bookmarks.userId, userId)),
      blocks: await this.db.select().from(s.userBlocks).where(eq(s.userBlocks.blockerId, userId)),
      civicIssues: await this.db.select().from(s.civicIssues).where(eq(s.civicIssues.reporterId, userId)),
      reportsFiled: await this.db
        .select({ id: s.contentReports.id, targetType: s.contentReports.targetType, reason: s.contentReports.reason, status: s.contentReports.status, createdAt: s.contentReports.createdAt })
        .from(s.contentReports)
        .where(eq(s.contentReports.reporterId, userId)),
      sanctions: await this.db.select().from(s.userSanctions).where(eq(s.userSanctions.userId, userId)),
      serviceRequests: await this.db.select().from(s.serviceRequests).where(eq(s.serviceRequests.requesterId, userId)),
      providerReviews: await this.db.select().from(s.providerReviews).where(eq(s.providerReviews.reviewerId, userId)),
      assistantConversations: convs,
      assistantMessages: convs.length ? await this.db.select().from(s.aiMessages).where(inArray(s.aiMessages.conversationId, convs.map((c) => c.id))) : [],
      attachments: await this.db
        .select({ id: s.attachments.id, purpose: s.attachments.purpose, originalName: s.attachments.originalName, mimeType: s.attachments.mimeType, sizeBytes: s.attachments.sizeBytes, createdAt: s.attachments.createdAt })
        .from(s.attachments)
        .where(and(eq(s.attachments.ownerUserId, userId), sql`${s.attachments.purpose} <> 'export'`)),
      notifications: await this.db.select().from(s.notifications).where(eq(s.notifications.userId, userId)),
      privacyRequests: await this.db.select().from(s.privacyRequests).where(eq(s.privacyRequests.userId, userId)),
      activityLog: await this.db
        .select({ action: s.auditEvents.action, targetType: s.auditEvents.targetType, createdAt: s.auditEvents.createdAt })
        .from(s.auditEvents)
        .where(eq(s.auditEvents.subjectUserId, userId)),
      notes: {
        attachmentsContent: 'Attachment files are not embedded; download them from the app before deleting your account.',
        taskIds: taskIds.length,
      },
    };
  }

  // ------------------------------------------------------------------ worker: deletion
  /** Permanently deletes accounts whose grace period has ended. */
  async runDeletionSweep() {
    const cutoff = addDays(new Date(), -this.env.ACCOUNT_DELETION_GRACE_DAYS);
    const due = await this.db
      .select({ id: s.users.id })
      .from(s.users)
      .where(and(eq(s.users.status, 'pending_deletion'), lt(s.users.deletionRequestedAt, cutoff)))
      .limit(50);
    for (const u of due) {
      try {
        await this.deleteAccountNow(u.id);
      } catch (e) {
        this.logger.error(`Deletion failed for one account: ${(e as Error).message}`);
      }
    }
    return due.length;
  }

  async deleteAccountNow(userId: string) {
    const files = await this.db.select({ id: s.attachments.id, key: s.attachments.storageKey }).from(s.attachments).where(eq(s.attachments.ownerUserId, userId));
    for (const f of files) await this.storage.delete(f.key).catch(() => undefined);

    const ownedProviders = await this.db
      .select({ id: s.providerMembers.providerId })
      .from(s.providerMembers)
      .where(and(eq(s.providerMembers.userId, userId), eq(s.providerMembers.role, 'owner')));
    const hhs = await this.db.select({ id: s.householdMembers.householdId }).from(s.householdMembers).where(eq(s.householdMembers.userId, userId));

    await this.db.transaction(async (tx) => {
      await tx
        .update(s.privacyRequests)
        .set({ status: 'completed', completedAt: new Date(), resolutionNote: 'Account and personal data deleted' })
        .where(and(eq(s.privacyRequests.userId, userId), eq(s.privacyRequests.type, 'delete'), inArray(s.privacyRequests.status, ['received', 'in_progress'])));
      await tx.delete(s.users).where(eq(s.users.id, userId));
      // Households with no members left are removed; others get a new admin if needed.
      for (const h of hhs) {
        const members = await tx.select().from(s.householdMembers).where(eq(s.householdMembers.householdId, h.id));
        if (!members.length) await tx.delete(s.households).where(eq(s.households.id, h.id));
        else if (!members.some((m) => m.role === 'admin')) {
          const oldest = members.sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime())[0];
          await tx
            .update(s.householdMembers)
            .set({ role: 'admin' })
            .where(and(eq(s.householdMembers.householdId, h.id), eq(s.householdMembers.userId, oldest.userId)));
        }
      }
      for (const p of ownedProviders) {
        const [left] = await tx.select().from(s.providerMembers).where(eq(s.providerMembers.providerId, p.id)).limit(1);
        if (!left) await tx.update(s.serviceProviders).set({ status: 'suspended', rejectionReason: 'Owner account deleted' }).where(eq(s.serviceProviders.id, p.id));
      }
      await this.audit.system({ action: 'privacy.account_deleted', targetType: 'user', targetId: userId }, tx);
    });
  }
}
