import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNull, lt, sql } from 'drizzle-orm';
import { AuditService } from '../../common/audit.service';
import { Actor, StaffRoleName } from '../../common/auth-context';
import { maskEmail, maskPhone, normalizeEmail, normalizePhone } from '../../common/crypto.service';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../common/errors';
import { CursorQuery, keyset, lim, pageOf } from '../../common/pagination';
import { JOBS, QueueService } from '../../common/queue.service';
import { addDays } from '../../common/time';
import { Database, DB } from '../../db/db';
import {
  appConfig,
  auditEvents,
  communityGroups,
  contentReports,
  localities,
  notificationJobs,
  officialChannels,
  plans,
  posts,
  privacyRequests,
  providerMembers,
  providerVerificationRecords,
  serviceCategories,
  serviceProviders,
  sessions,
  staffRoles,
  subscriptions,
  userSanctions,
  users,
} from '../../db/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { PrivacyService } from '../privacy/privacy.service';

/**
 * Staff operations. By design there is no endpoint that returns a user's private content
 * (tasks, lists, check-ins, cases, messages). Staff see account metadata and audit events only.
 */
@Injectable()
export class AdminService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly queue: QueueService,
    private readonly privacy: PrivacyService,
  ) {}

  async overview() {
    const one = async (q: Promise<{ n: number }[]>) => (await q)[0]?.n ?? 0;
    const n = sql<number>`count(*)::int`;
    return {
      users: {
        total: await one(this.db.select({ n }).from(users).where(inArray(users.status, ['active', 'pending_deletion']))),
        active7d: await one(this.db.select({ n }).from(users).where(gt(users.lastActiveAt, addDays(new Date(), -7)))),
        disabled: await one(this.db.select({ n }).from(users).where(eq(users.status, 'disabled'))),
        pendingDeletion: await one(this.db.select({ n }).from(users).where(eq(users.status, 'pending_deletion'))),
      },
      community: {
        activeGroups: await one(this.db.select({ n }).from(communityGroups).where(eq(communityGroups.status, 'active'))),
        posts24h: await one(this.db.select({ n }).from(posts).where(gt(posts.createdAt, addDays(new Date(), -1)))),
        openReports: await one(this.db.select({ n }).from(contentReports).where(inArray(contentReports.status, ['open', 'in_review']))),
      },
      providers: {
        pendingReview: await one(this.db.select({ n }).from(serviceProviders).where(eq(serviceProviders.status, 'pending_review'))),
        active: await one(this.db.select({ n }).from(serviceProviders).where(eq(serviceProviders.status, 'active'))),
      },
      privacy: {
        open: await one(this.db.select({ n }).from(privacyRequests).where(inArray(privacyRequests.status, ['received', 'in_progress']))),
        overdue: await one(this.db.select({ n }).from(privacyRequests).where(and(inArray(privacyRequests.status, ['received', 'in_progress']), lt(privacyRequests.dueAt, new Date())))),
      },
      notifications24h: await this.db
        .select({ channel: notificationJobs.channel, status: notificationJobs.status, n })
        .from(notificationJobs)
        .where(gt(notificationJobs.createdAt, addDays(new Date(), -1)))
        .groupBy(notificationJobs.channel, notificationJobs.status),
      queues: Object.fromEntries(await Promise.all(Object.values(JOBS).map(async (name) => [name, await this.queue.boss.getQueueSize(name).catch(() => null)]))),
    };
  }

  // ------------------------------------------------------------------ users (metadata only)
  async findUsers(q: { phone?: string; email?: string; userId?: string }) {
    let where;
    if (q.userId) where = eq(users.id, q.userId);
    else if (q.phone) {
      const p = normalizePhone(q.phone);
      if (!p) throw badRequest('Invalid phone');
      where = eq(users.phoneE164, p);
    } else if (q.email) {
      const e = normalizeEmail(q.email);
      if (!e) throw badRequest('Invalid email');
      where = eq(users.email, e);
    } else throw badRequest('Search by exact phone, email or user id', 'exact_search_required');
    const rows = await this.db.select().from(users).where(where).limit(5);
    const out = [];
    for (const u of rows) {
      const sanctions = await this.db.select().from(userSanctions).where(eq(userSanctions.userId, u.id)).orderBy(desc(userSanctions.createdAt)).limit(20);
      const roles = await this.db.select({ role: staffRoles.role }).from(staffRoles).where(and(eq(staffRoles.userId, u.id), isNull(staffRoles.revokedAt)));
      out.push({
        id: u.id,
        status: u.status,
        disabledReason: u.disabledReason,
        phone: u.phoneE164 ? maskPhone(u.phoneE164) : null,
        email: u.email ? maskEmail(u.email) : null,
        createdAt: u.createdAt,
        lastActiveAt: u.lastActiveAt,
        deletionRequestedAt: u.deletionRequestedAt,
        staffRoles: roles.map((r) => r.role),
        sanctions,
      });
    }
    return out;
  }

  async setUserStatus(actor: Actor, userId: string, disable: boolean, reason: string) {
    if (userId === actor.userId) throw forbidden('You cannot change your own account status');
    const [u] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!u || u.status === 'deleted') throw notFound('User');
    await this.db.update(users).set(disable ? { status: 'disabled', disabledReason: reason } : { status: 'active', disabledReason: null }).where(eq(users.id, userId));
    if (disable) await this.db.update(sessions).set({ revokedAt: new Date(), revokedReason: 'account_disabled' }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
    await this.audit.record(actor, { action: disable ? 'admin.user_disabled' : 'admin.user_enabled', targetType: 'user', targetId: userId, subjectUserId: userId, asStaff: true });
    return { id: userId, status: disable ? 'disabled' : 'active' };
  }

  async revokeSessions(actor: Actor, userId: string) {
    const res = await this.db.update(sessions).set({ revokedAt: new Date(), revokedReason: 'admin' }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt))).returning({ id: sessions.id });
    await this.audit.record(actor, { action: 'admin.sessions_revoked', targetType: 'user', targetId: userId, subjectUserId: userId, asStaff: true, metadata: { count: res.length } });
    return { revoked: res.length };
  }

  // ------------------------------------------------------------------ staff roles
  async staff() {
    return this.db.select().from(staffRoles).where(isNull(staffRoles.revokedAt)).orderBy(asc(staffRoles.grantedAt));
  }

  async grantRole(actor: Actor, userId: string, role: StaffRoleName) {
    if (userId === actor.userId) throw forbidden('You cannot grant roles to yourself', 'separation_of_duties');
    const [u] = await this.db.select({ id: users.id, status: users.status }).from(users).where(eq(users.id, userId));
    if (!u || u.status !== 'active') throw notFound('User');
    const ins = await this.db.insert(staffRoles).values({ userId, role, grantedBy: actor.userId }).onConflictDoNothing().returning();
    if (!ins.length) throw conflict('Role already granted', 'already_granted');
    await this.audit.record(actor, { action: 'admin.staff_role_granted', targetType: 'user', targetId: userId, subjectUserId: userId, asStaff: true, metadata: { role } });
    await this.notifications.notify({ userId, category: 'security', template: 'staff_role', title: `You were given the ${role.replace('_', ' ')} role`, body: 'Staff access requires two-factor authentication.', channels: ['email'] });
    return ins[0];
  }

  async revokeRole(actor: Actor, id: string) {
    const [r] = await this.db.update(staffRoles).set({ revokedAt: new Date() }).where(and(eq(staffRoles.id, id), isNull(staffRoles.revokedAt))).returning();
    if (!r) throw notFound('Role');
    await this.audit.record(actor, { action: 'admin.staff_role_revoked', targetType: 'user', targetId: r.userId, subjectUserId: r.userId, asStaff: true, metadata: { role: r.role } });
    return r;
  }

  // ------------------------------------------------------------------ privacy requests
  async privacyRequests(q: CursorQuery & { status?: string; type?: string }) {
    const limit = lim(q);
    const rows = await this.db
      .select({ id: privacyRequests.id, userId: privacyRequests.userId, type: privacyRequests.type, status: privacyRequests.status, details: privacyRequests.details, dueAt: privacyRequests.dueAt, createdAt: privacyRequests.createdAt, completedAt: privacyRequests.completedAt, handledBy: privacyRequests.handledBy })
      .from(privacyRequests)
      .where(
        and(
          q.status ? eq(privacyRequests.status, q.status as 'received') : inArray(privacyRequests.status, ['received', 'in_progress']),
          q.type ? eq(privacyRequests.type, q.type as 'export') : undefined,
          keyset(privacyRequests.createdAt, privacyRequests.id, q.cursor, 'asc'),
        ),
      )
      .orderBy(asc(privacyRequests.createdAt), asc(privacyRequests.id))
      .limit(limit + 1);
    return pageOf(rows, limit, (r) => [r.createdAt, r.id]);
  }

  async handlePrivacyRequest(actor: Actor, id: string, action: 'start' | 'complete' | 'reject' | 'retry_export', note?: string) {
    const [r] = await this.db.select().from(privacyRequests).where(eq(privacyRequests.id, id));
    if (!r) throw notFound('Privacy request');
    if (action === 'retry_export') {
      if (r.type !== 'export') throw unprocessable('Only export requests can be retried');
      await this.queue.send(JOBS.privacyExport, { requestId: id });
    } else {
      if (r.type === 'delete' && action === 'complete') throw unprocessable('Deletion completes automatically after the grace period', 'automatic');
      if (['completed', 'rejected', 'cancelled'].includes(r.status)) throw unprocessable('Request already closed');
      if ((action === 'reject' || action === 'complete') && !note) throw badRequest('A note to the user is required', 'note_required');
      await this.db
        .update(privacyRequests)
        .set({ status: action === 'start' ? 'in_progress' : action === 'complete' ? 'completed' : 'rejected', handledBy: actor.userId, resolutionNote: note ?? r.resolutionNote, completedAt: action === 'start' ? null : new Date() })
        .where(eq(privacyRequests.id, id));
      if (r.userId && action !== 'start') {
        await this.notifications.notify({ userId: r.userId, category: 'privacy', template: 'privacy_request_closed', title: `Your ${r.type} request was ${action === 'complete' ? 'completed' : 'declined'}`, body: note, data: { type: 'privacy_request', id }, channels: ['push', 'email'] });
      }
    }
    await this.audit.record(actor, { action: `admin.privacy_${action}`, targetType: 'privacy_request', targetId: id, subjectUserId: r.userId, asStaff: true });
    const [u] = await this.db.select().from(privacyRequests).where(eq(privacyRequests.id, id));
    return u;
  }

  // ------------------------------------------------------------------ providers
  async providers(q: CursorQuery & { status?: string }) {
    const limit = lim(q);
    const rows = await this.db
      .select()
      .from(serviceProviders)
      .where(and(q.status ? eq(serviceProviders.status, q.status as 'pending_review') : undefined, keyset(serviceProviders.createdAt, serviceProviders.id, q.cursor)))
      .orderBy(desc(serviceProviders.createdAt), desc(serviceProviders.id))
      .limit(limit + 1);
    return pageOf(rows, limit, (r) => [r.createdAt, r.id]);
  }

  async provider(id: string) {
    const [p] = await this.db.select().from(serviceProviders).where(eq(serviceProviders.id, id));
    if (!p) throw notFound('Provider');
    const checks = await this.db.select().from(providerVerificationRecords).where(eq(providerVerificationRecords.providerId, id)).orderBy(desc(providerVerificationRecords.createdAt));
    const members = await this.db.select().from(providerMembers).where(eq(providerMembers.providerId, id));
    return { ...p, verification: checks, members };
  }

  private async assertNotMember(actor: Actor, providerId: string) {
    const [m] = await this.db.select().from(providerMembers).where(and(eq(providerMembers.providerId, providerId), eq(providerMembers.userId, actor.userId)));
    if (m) throw forbidden('You cannot review a provider you belong to', 'conflict_of_interest');
  }

  async decideProvider(actor: Actor, id: string, decision: 'approve' | 'reject' | 'suspend' | 'reinstate', reason?: string) {
    await this.assertNotMember(actor, id);
    const [p] = await this.db.select().from(serviceProviders).where(eq(serviceProviders.id, id));
    if (!p) throw notFound('Provider');
    const allowed: Record<string, string[]> = { approve: ['pending_review'], reject: ['pending_review'], suspend: ['active'], reinstate: ['suspended'] };
    if (!allowed[decision].includes(p.status)) throw unprocessable(`Cannot ${decision} a provider that is ${p.status}`, 'invalid_transition');
    if ((decision === 'reject' || decision === 'suspend') && !reason) throw badRequest('A reason is required', 'reason_required');
    const status = decision === 'approve' || decision === 'reinstate' ? 'active' : decision === 'reject' ? 'rejected' : 'suspended';
    const [u] = await this.db
      .update(serviceProviders)
      .set({ status, rejectionReason: reason ?? null, ...(decision === 'approve' ? { approvedAt: new Date(), approvedBy: actor.userId } : {}) })
      .where(eq(serviceProviders.id, id))
      .returning();
    const members = await this.db.select({ u: providerMembers.userId }).from(providerMembers).where(eq(providerMembers.providerId, id));
    for (const m of members) {
      await this.notifications.notify({ userId: m.u, category: 'services', template: `provider_${decision}`, title: `Your provider profile "${p.displayName}" was ${status === 'active' ? 'approved' : status}`, body: reason, data: { type: 'provider', id }, channels: ['push', 'email'] });
    }
    await this.audit.record(actor, { action: `admin.provider_${decision}`, targetType: 'provider', targetId: id, asStaff: true });
    return u;
  }

  /** Records a check and recomputes the verification level. Levels are derived from passed, unexpired checks only. */
  async recordVerification(actor: Actor, providerId: string, dto: { checkType: 'identity' | 'address' | 'background' | 'business_registration' | 'reference' | 'training'; status: 'pending' | 'passed' | 'failed'; performedByPartner?: string; note?: string; expiresAt?: string }) {
    await this.assertNotMember(actor, providerId);
    const [p] = await this.db.select({ id: serviceProviders.id }).from(serviceProviders).where(eq(serviceProviders.id, providerId));
    if (!p) throw notFound('Provider');
    if (dto.note && /\b\d{4}\s?\d{4}\s?\d{4}\b|[A-Z]{5}\d{4}[A-Z]/.test(dto.note)) {
      throw badRequest('Do not record ID numbers. Reference the partner report instead.', 'sensitive_data');
    }
    const [rec] = await this.db
      .insert(providerVerificationRecords)
      .values({ providerId, checkType: dto.checkType, status: dto.status, performedByPartner: dto.performedByPartner, note: dto.note, reviewerId: actor.userId, checkedAt: dto.status === 'pending' ? null : new Date(), expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null })
      .returning();
    const level = await this.recomputeLevel(providerId);
    await this.audit.record(actor, { action: 'admin.provider_verification', targetType: 'provider', targetId: providerId, asStaff: true, metadata: { checkType: dto.checkType, status: dto.status, level } });
    return { record: rec, verificationLevel: level };
  }

  async recomputeLevel(providerId: string) {
    const passed = await this.db
      .select({ t: providerVerificationRecords.checkType, exp: providerVerificationRecords.expiresAt })
      .from(providerVerificationRecords)
      .where(and(eq(providerVerificationRecords.providerId, providerId), eq(providerVerificationRecords.status, 'passed')));
    const live = new Set(passed.filter((x) => !x.exp || x.exp > new Date()).map((x) => x.t));
    const level = live.has('identity') && live.has('background') ? 'screened' : live.has('identity') ? 'basic' : 'none';
    await this.db.update(serviceProviders).set({ verificationLevel: level }).where(eq(serviceProviders.id, providerId));
    return level;
  }

  /** Worker (daily): expire checks past their date and downgrade levels. */
  async expireVerifications() {
    const expired = await this.db
      .update(providerVerificationRecords)
      .set({ status: 'expired' })
      .where(and(eq(providerVerificationRecords.status, 'passed'), lt(providerVerificationRecords.expiresAt, new Date())))
      .returning({ providerId: providerVerificationRecords.providerId });
    for (const id of new Set(expired.map((e) => e.providerId))) await this.recomputeLevel(id);
    return expired.length;
  }

  async setSponsorship(actor: Actor, providerId: string, isSponsored: boolean, sponsoredUntil?: string) {
    const [p] = await this.db.update(serviceProviders).set({ isSponsored, sponsoredUntil: sponsoredUntil ? new Date(sponsoredUntil) : null }).where(eq(serviceProviders.id, providerId)).returning();
    if (!p) throw notFound('Provider');
    await this.audit.record(actor, { action: 'admin.provider_sponsorship', targetType: 'provider', targetId: providerId, asStaff: true, metadata: { isSponsored } });
    return p;
  }

  // ------------------------------------------------------------------ catalogue data
  async upsertCategory(actor: Actor, id: string | null, dto: { slug?: string; name?: string; description?: string; parentId?: string | null; requiresVerification?: boolean; seniorSupport?: boolean; active?: boolean; sortOrder?: number }) {
    const row = id
      ? (await this.db.update(serviceCategories).set(dto).where(eq(serviceCategories.id, id)).returning())[0]
      : (await this.db.insert(serviceCategories).values(dto as typeof serviceCategories.$inferInsert).returning())[0];
    if (!row) throw notFound('Category');
    await this.audit.record(actor, { action: id ? 'admin.category_updated' : 'admin.category_created', targetType: 'service_category', targetId: row.id, asStaff: true });
    return row;
  }

  async upsertLocality(actor: Actor, id: string | null, dto: { name?: string; city?: string; state?: string; country?: string; pincodePrefix?: string; lat?: string; lng?: string; active?: boolean }) {
    const round = (v?: string) => (v === undefined ? undefined : Number(v).toFixed(2));
    const values = { ...dto, lat: round(dto.lat), lng: round(dto.lng) };
    const row = id
      ? (await this.db.update(localities).set(values).where(eq(localities.id, id)).returning())[0]
      : (await this.db.insert(localities).values(values as typeof localities.$inferInsert).returning())[0];
    if (!row) throw notFound('Locality');
    await this.audit.record(actor, { action: id ? 'admin.locality_updated' : 'admin.locality_created', targetType: 'locality', targetId: row.id, asStaff: true });
    return row;
  }

  async channels() {
    return this.db.select().from(officialChannels).orderBy(asc(officialChannels.kind), asc(officialChannels.name));
  }

  async upsertChannel(actor: Actor, id: string | null, dto: Partial<typeof officialChannels.$inferInsert>) {
    const row = id
      ? (await this.db.update(officialChannels).set(dto).where(eq(officialChannels.id, id)).returning())[0]
      : (await this.db.insert(officialChannels).values(dto as typeof officialChannels.$inferInsert).returning())[0];
    if (!row) throw notFound('Channel');
    await this.audit.record(actor, { action: id ? 'admin.channel_updated' : 'admin.channel_created', targetType: 'official_channel', targetId: row.id, asStaff: true });
    return row;
  }

  // ------------------------------------------------------------------ config, plans
  async config() {
    return this.db.select().from(appConfig).orderBy(asc(appConfig.key));
  }

  async setConfig(actor: Actor, key: string, value: unknown, description?: string) {
    const [row] = await this.db
      .insert(appConfig)
      .values({ key, value: value as object, description, updatedBy: actor.userId })
      .onConflictDoUpdate({ target: appConfig.key, set: { value: value as object, description, updatedBy: actor.userId } })
      .returning();
    await this.audit.record(actor, { action: 'admin.config_set', targetType: 'config', asStaff: true, metadata: { key } });
    return row;
  }

  async plans() {
    return this.db.select().from(plans);
  }

  async upsertPlan(actor: Actor, dto: typeof plans.$inferInsert) {
    const [row] = await this.db.insert(plans).values(dto).onConflictDoUpdate({ target: plans.code, set: { name: dto.name, features: dto.features, active: dto.active } }).returning();
    await this.audit.record(actor, { action: 'admin.plan_upserted', targetType: 'plan', asStaff: true, metadata: { code: dto.code } });
    return row;
  }

  async grantSubscription(actor: Actor, dto: { subjectType: 'user' | 'household' | 'provider'; subjectId: string; planCode: string; endsAt?: string; source?: string }) {
    const [row] = await this.db.insert(subscriptions).values({ ...dto, endsAt: dto.endsAt ? new Date(dto.endsAt) : null }).returning();
    await this.audit.record(actor, { action: 'admin.subscription_granted', targetType: 'subscription', targetId: row.id, asStaff: true, metadata: { plan: dto.planCode } });
    return row;
  }

  // ------------------------------------------------------------------ audit
  async auditLog(q: CursorQuery & { action?: string; actorId?: string; targetType?: string; targetId?: string; subjectUserId?: string }) {
    const limit = lim(q);
    const rows = await this.db
      .select()
      .from(auditEvents)
      .where(
        and(
          q.action ? eq(auditEvents.action, q.action) : undefined,
          q.actorId ? eq(auditEvents.actorId, q.actorId) : undefined,
          q.targetType ? eq(auditEvents.targetType, q.targetType) : undefined,
          q.targetId ? eq(auditEvents.targetId, q.targetId) : undefined,
          q.subjectUserId ? eq(auditEvents.subjectUserId, q.subjectUserId) : undefined,
          keyset(auditEvents.createdAt, auditEvents.id, q.cursor),
        ),
      )
      .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
      .limit(limit + 1);
    return pageOf(rows, limit, (r) => [r.createdAt, r.id]);
  }

  async notificationFailures() {
    return this.db
      .select({ channel: notificationJobs.channel, provider: notificationJobs.provider, template: notificationJobs.template, lastError: notificationJobs.lastError, n: sql<number>`count(*)::int` })
      .from(notificationJobs)
      .where(and(eq(notificationJobs.status, 'failed'), gt(notificationJobs.createdAt, addDays(new Date(), -7))))
      .groupBy(notificationJobs.channel, notificationJobs.provider, notificationJobs.template, notificationJobs.lastError)
      .orderBy(desc(sql`count(*)`))
      .limit(100);
  }

  runDeletionSweepNow() {
    return this.privacy.runDeletionSweep();
  }
}
