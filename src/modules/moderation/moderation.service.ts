import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { AuditService } from '../../common/audit.service';
import { Actor } from '../../common/auth-context';
import { AppError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../common/errors';
import { CursorQuery, keyset, lim, pageOf } from '../../common/pagination';
import { addDays } from '../../common/time';
import { Env, ENV } from '../../config/env';
import { Database, DB } from '../../db/db';
import {
  comments,
  communityGroups,
  contentReports,
  contentSnapshots,
  moderationActions,
  moderationAppeals,
  posts,
  providerReviews,
  serviceProviders,
  serviceRequests,
  userProfiles,
  userSanctions,
  users,
} from '../../db/schema';
import { NotificationsService } from '../notifications/notifications.service';

export type TargetType = 'post' | 'comment' | 'user' | 'group' | 'provider' | 'service_request' | 'review';
export type ReportReason = 'spam' | 'harassment' | 'hate' | 'fraud' | 'impersonation' | 'privacy' | 'unsafe' | 'misinformation' | 'other';
export type ActionKind = 'hide' | 'remove' | 'restore' | 'warn' | 'suspend_posting' | 'suspend' | 'ban' | 'dismiss';

const HIGH_PRIORITY: ReportReason[] = ['unsafe', 'fraud', 'impersonation', 'privacy'];
const AUTO_HIDE_THRESHOLD = 3;

@Injectable()
export class ModerationService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ------------------------------------------------------------------ sanctions & spam (used by community/services)
  async activeSanctions(userId: string) {
    const now = new Date();
    return this.db
      .select()
      .from(userSanctions)
      .where(and(eq(userSanctions.userId, userId), isNull(userSanctions.liftedAt), sql`${userSanctions.startsAt} <= ${now}`, or(isNull(userSanctions.endsAt), gt(userSanctions.endsAt, now))));
  }

  async assertCanPost(userId: string) {
    const s = await this.activeSanctions(userId);
    const blocking = s.find((x) => ['posting_suspended', 'suspended', 'banned'].includes(x.kind));
    if (blocking) {
      throw new AppError(403, 'posting_restricted', blocking.endsAt ? `Posting is paused until ${blocking.endsAt.toDateString()}.` : 'Posting is not available on this account.', {
        sanctionId: blocking.id,
      });
    }
  }

  /**
   * Lightweight spam heuristics. Returns a reason when content should be held for review rather than published.
   * Rate limits throw immediately.
   */
  async spamCheck(userId: string, text: string, kind: 'post' | 'comment'): Promise<string | null> {
    const hourAgo = new Date(Date.now() - 3600_000);
    if (kind === 'post') {
      const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(posts).where(and(eq(posts.authorId, userId), gt(posts.createdAt, hourAgo)));
      if (n >= 10) throw new AppError(429, 'posting_too_fast', 'You are posting very quickly. Please wait a while.');
      const [dup] = await this.db
        .select({ id: posts.id })
        .from(posts)
        .where(and(eq(posts.authorId, userId), eq(posts.body, text), gt(posts.createdAt, addDays(new Date(), -1))))
        .limit(1);
      if (dup) return 'duplicate_content';
    } else {
      const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(comments).where(and(eq(comments.authorId, userId), gt(comments.createdAt, hourAgo)));
      if (n >= 60) throw new AppError(429, 'commenting_too_fast', 'You are commenting very quickly. Please wait a while.');
    }
    const links = (text.match(/https?:\/\/|www\./gi) ?? []).length;
    const [u] = await this.db.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, userId));
    const newAccount = u && Date.now() - u.createdAt.getTime() < 24 * 3600_000;
    if (links > 5) return 'too_many_links';
    if (newAccount && links > 0) return 'new_account_links';
    if (/(\+?\d[\d\s-]{9,}).*(\+?\d[\d\s-]{9,})/.test(text) && links > 0) return 'contact_spam';
    return null;
  }

  /** System report for content held by the filters. */
  async systemReport(targetType: TargetType, targetId: string, targetUserId: string, groupId: string | null, reason: string) {
    const [r] = await this.db
      .insert(contentReports)
      .values({ reporterId: null, source: 'filter', targetType, targetId, targetUserId, groupId, reason: 'spam', details: `Automatic: ${reason}`, priority: 1 })
      .returning();
    await this.snapshot(r.id, targetType, targetId);
    return r;
  }

  // ------------------------------------------------------------------ reports (any user)
  private async resolveTarget(targetType: TargetType, targetId: string): Promise<{ ownerId: string | null; groupId: string | null; snapshot: Record<string, unknown> } | null> {
    switch (targetType) {
      case 'post': {
        const [p] = await this.db.select().from(posts).where(eq(posts.id, targetId));
        return p ? { ownerId: p.authorId, groupId: p.groupId, snapshot: { kind: p.kind, title: p.title, body: p.body, status: p.status, createdAt: p.createdAt } } : null;
      }
      case 'comment': {
        const [c] = await this.db.select({ c: comments, groupId: posts.groupId }).from(comments).innerJoin(posts, eq(posts.id, comments.postId)).where(eq(comments.id, targetId));
        return c ? { ownerId: c.c.authorId, groupId: c.groupId, snapshot: { body: c.c.body, postId: c.c.postId, createdAt: c.c.createdAt } } : null;
      }
      case 'user': {
        const [u] = await this.db.select({ id: userProfiles.userId, displayName: userProfiles.displayName, bio: userProfiles.bio }).from(userProfiles).where(eq(userProfiles.userId, targetId));
        return u ? { ownerId: u.id, groupId: null, snapshot: { displayName: u.displayName, bio: u.bio } } : null;
      }
      case 'group': {
        const [g] = await this.db.select().from(communityGroups).where(eq(communityGroups.id, targetId));
        return g ? { ownerId: g.createdBy, groupId: g.id, snapshot: { name: g.name, description: g.description, rules: g.rules } } : null;
      }
      case 'provider': {
        const [p] = await this.db.select().from(serviceProviders).where(eq(serviceProviders.id, targetId));
        return p ? { ownerId: p.createdBy, groupId: null, snapshot: { displayName: p.displayName, description: p.description } } : null;
      }
      case 'review': {
        const [r] = await this.db.select().from(providerReviews).where(eq(providerReviews.id, targetId));
        return r ? { ownerId: r.reviewerId, groupId: null, snapshot: { rating: r.rating, body: r.body } } : null;
      }
      case 'service_request': {
        const [s] = await this.db.select().from(serviceRequests).where(eq(serviceRequests.id, targetId));
        return s ? { ownerId: s.requesterId, groupId: null, snapshot: { title: s.title, status: s.status } } : null;
      }
    }
  }

  private async snapshot(reportId: string, targetType: TargetType, targetId: string) {
    const t = await this.resolveTarget(targetType, targetId);
    if (!t) return;
    await this.db.insert(contentSnapshots).values({ reportId, targetType, targetId, snapshot: t.snapshot, retainUntil: addDays(new Date(), this.env.EVIDENCE_RETENTION_DAYS) });
  }

  async report(actor: Actor, dto: { targetType: TargetType; targetId: string; reason: ReportReason; details?: string }, canSee: (t: TargetType, id: string) => Promise<boolean>) {
    const t = await this.resolveTarget(dto.targetType, dto.targetId);
    if (!t || !(await canSee(dto.targetType, dto.targetId))) throw notFound('Content');
    if (t.ownerId === actor.userId) throw badRequest('You cannot report your own content', 'self_report');
    const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(contentReports).where(and(eq(contentReports.reporterId, actor.userId), gt(contentReports.createdAt, addDays(new Date(), -1))));
    if (n >= 30) throw new AppError(429, 'report_rate_limited', 'You have sent many reports today. Our team will review them.');
    const inserted = await this.db
      .insert(contentReports)
      .values({
        reporterId: actor.userId,
        targetType: dto.targetType,
        targetId: dto.targetId,
        targetUserId: t.ownerId,
        groupId: t.groupId,
        reason: dto.reason,
        details: dto.details,
        priority: HIGH_PRIORITY.includes(dto.reason) ? 2 : 0,
      })
      .onConflictDoNothing()
      .returning();
    if (!inserted.length) throw conflict('You already reported this. Our team will review it.', 'already_reported');
    const r = inserted[0];
    await this.snapshot(r.id, dto.targetType, dto.targetId);

    // Several independent reports hide a post/comment until a moderator reviews it.
    if (dto.targetType === 'post' || dto.targetType === 'comment') {
      const [{ c }] = await this.db
        .select({ c: sql<number>`count(distinct ${contentReports.reporterId})::int` })
        .from(contentReports)
        .where(and(eq(contentReports.targetType, dto.targetType), eq(contentReports.targetId, dto.targetId), inArray(contentReports.status, ['open', 'in_review'])));
      if (c >= AUTO_HIDE_THRESHOLD) {
        if (dto.targetType === 'post') await this.db.update(posts).set({ status: 'hidden' }).where(and(eq(posts.id, dto.targetId), eq(posts.status, 'published')));
        else await this.db.update(comments).set({ status: 'hidden' }).where(and(eq(comments.id, dto.targetId), eq(comments.status, 'published')));
        await this.audit.system({ action: 'moderation.auto_hidden', targetType: dto.targetType, targetId: dto.targetId, metadata: { reports: c } });
      }
    }
    await this.audit.record(actor, { action: 'report.created', targetType: 'content_report', targetId: r.id, metadata: { targetType: dto.targetType, reason: dto.reason } });
    return { id: r.id, status: r.status, message: 'Thanks. A moderator will review this. We do not share who reported.' };
  }

  async myReports(actor: Actor) {
    return this.db
      .select({ id: contentReports.id, targetType: contentReports.targetType, reason: contentReports.reason, status: contentReports.status, createdAt: contentReports.createdAt, resolvedAt: contentReports.resolvedAt })
      .from(contentReports)
      .where(eq(contentReports.reporterId, actor.userId))
      .orderBy(desc(contentReports.createdAt))
      .limit(100);
  }

  // ------------------------------------------------------------------ staff queue
  async queue(q: CursorQuery & { status?: string; reason?: string; targetType?: string; assignedToMe?: boolean }, actor: Actor) {
    const limit = lim(q);
    const rows = await this.db
      .select()
      .from(contentReports)
      .where(
        and(
          q.status ? eq(contentReports.status, q.status as 'open') : inArray(contentReports.status, ['open', 'in_review']),
          q.reason ? eq(contentReports.reason, q.reason as ReportReason) : undefined,
          q.targetType ? eq(contentReports.targetType, q.targetType as TargetType) : undefined,
          q.assignedToMe ? eq(contentReports.assignedTo, actor.userId) : undefined,
          keyset(contentReports.createdAt, contentReports.id, q.cursor, 'asc'),
        ),
      )
      .orderBy(asc(contentReports.createdAt), asc(contentReports.id))
      .limit(limit + 1);
    const page = pageOf(rows, limit, (r) => [r.createdAt, r.id]);
    // Reporter identity is never shown to moderators.
    return { ...page, items: page.items.map(({ reporterId: _r, ...rest }) => rest) };
  }

  async reportDetail(id: string) {
    const [r] = await this.db.select().from(contentReports).where(eq(contentReports.id, id));
    if (!r) throw notFound('Report');
    const snapshots = await this.db.select().from(contentSnapshots).where(eq(contentSnapshots.reportId, id));
    const related = await this.db
      .select({ id: contentReports.id, reason: contentReports.reason, status: contentReports.status, createdAt: contentReports.createdAt })
      .from(contentReports)
      .where(and(eq(contentReports.targetType, r.targetType), eq(contentReports.targetId, r.targetId)));
    const history = r.targetUserId
      ? await this.db.select().from(moderationActions).where(eq(moderationActions.targetUserId, r.targetUserId)).orderBy(desc(moderationActions.createdAt)).limit(20)
      : [];
    const sanctions = r.targetUserId ? await this.activeSanctions(r.targetUserId) : [];
    const { reporterId: _r, ...report } = r;
    return {
      report,
      evidence: snapshots,
      relatedReports: related,
      targetUserHistory: { priorActions: history.filter((h) => h.action !== 'dismiss' && h.action !== 'restore').length, actions: history, activeSanctions: sanctions },
      suggestion: this.suggest(history.filter((h) => !['dismiss', 'restore'].includes(h.action)).length),
    };
  }

  /** Repeat-offender guidance; the moderator decides. */
  private suggest(prior: number) {
    if (prior === 0) return 'First issue: consider hide/remove and a warning.';
    if (prior < 3) return 'Repeat issue: consider a 7-day posting suspension.';
    return 'Repeated issues: consider a longer suspension or ban (senior moderator review recommended).';
  }

  async assign(actor: Actor, id: string) {
    const [r] = await this.db.update(contentReports).set({ assignedTo: actor.userId, status: 'in_review' }).where(and(eq(contentReports.id, id), inArray(contentReports.status, ['open', 'in_review']))).returning();
    if (!r) throw notFound('Report');
    await this.audit.record(actor, { action: 'moderation.report_assigned', targetType: 'content_report', targetId: id, asStaff: true });
    return r;
  }

  /** Apply a moderation action. Used by staff (scope platform) and group admins (scope group: hide/remove/restore only). */
  async act(
    actor: Actor,
    dto: { reportId?: string; targetType: TargetType; targetId: string; action: ActionKind; reason: string; durationDays?: number },
    scope: 'platform' | 'group' = 'platform',
  ) {
    if (scope === 'group' && !['hide', 'remove', 'restore'].includes(dto.action)) throw forbidden('Group admins can only hide, remove or restore content');
    const t = await this.resolveTarget(dto.targetType, dto.targetId);
    if (!t) throw notFound('Content');
    if (t.ownerId === actor.userId && scope === 'platform') throw forbidden('You cannot moderate your own content', 'conflict_of_interest');
    const expiresAt = dto.durationDays ? addDays(new Date(), dto.durationDays) : null;
    if (['suspend_posting', 'suspend'].includes(dto.action) && !dto.durationDays) throw badRequest('durationDays is required for suspensions', 'duration_required');

    const action = await this.db.transaction(async (tx) => {
      const [a] = await tx
        .insert(moderationActions)
        .values({ reportId: dto.reportId, moderatorId: actor.userId, targetType: dto.targetType, targetId: dto.targetId, targetUserId: t.ownerId, action: dto.action, reason: dto.reason, scope, expiresAt })
        .returning();
      const contentStatus = dto.action === 'hide' ? 'hidden' : dto.action === 'remove' ? 'removed' : dto.action === 'restore' ? 'published' : null;
      if (contentStatus) {
        if (dto.targetType === 'post') await tx.update(posts).set({ status: contentStatus, removedReason: contentStatus === 'removed' ? dto.reason : null }).where(eq(posts.id, dto.targetId));
        if (dto.targetType === 'comment') await tx.update(comments).set({ status: contentStatus }).where(eq(comments.id, dto.targetId));
        if (dto.targetType === 'review') await tx.update(providerReviews).set({ status: contentStatus }).where(eq(providerReviews.id, dto.targetId));
        if (dto.targetType === 'group' && dto.action !== 'restore') await tx.update(communityGroups).set({ status: 'suspended' }).where(eq(communityGroups.id, dto.targetId));
        if (dto.targetType === 'group' && dto.action === 'restore') await tx.update(communityGroups).set({ status: 'active' }).where(eq(communityGroups.id, dto.targetId));
        if (dto.targetType === 'provider' && dto.action !== 'restore') await tx.update(serviceProviders).set({ status: 'suspended' }).where(eq(serviceProviders.id, dto.targetId));
      }
      const sanctionKind = { warn: 'warning', suspend_posting: 'posting_suspended', suspend: 'suspended', ban: 'banned' }[dto.action as string] as
        | 'warning'
        | 'posting_suspended'
        | 'suspended'
        | 'banned'
        | undefined;
      if (sanctionKind && t.ownerId) {
        await tx.insert(userSanctions).values({ userId: t.ownerId, kind: sanctionKind, reason: dto.reason, actionId: a.id, endsAt: sanctionKind === 'warning' ? new Date() : expiresAt });
        if (sanctionKind === 'suspended' || sanctionKind === 'banned') {
          await tx.execute(sql`update auth.sessions set revoked_at = now(), revoked_reason = 'moderation' where user_id = ${t.ownerId} and revoked_at is null`);
          if (sanctionKind === 'banned') await tx.update(users).set({ status: 'disabled', disabledReason: 'Community guidelines' }).where(eq(users.id, t.ownerId));
        }
      }
      if (dto.reportId) {
        await tx
          .update(contentReports)
          .set({ status: dto.action === 'dismiss' ? 'dismissed' : 'actioned', resolvedAt: new Date() })
          .where(eq(contentReports.id, dto.reportId));
      }
      // Resolve other open reports about the same target.
      if (dto.action !== 'dismiss') {
        await tx
          .update(contentReports)
          .set({ status: 'actioned', resolvedAt: new Date() })
          .where(and(eq(contentReports.targetType, dto.targetType), eq(contentReports.targetId, dto.targetId), inArray(contentReports.status, ['open', 'in_review'])));
      }
      return a;
    });

    if (t.ownerId && dto.action !== 'dismiss' && t.ownerId !== actor.userId) {
      await this.notifications.notify({
        userId: t.ownerId,
        category: 'community',
        template: 'moderation_action',
        title: dto.action === 'restore' ? 'Your content was restored' : 'A moderation decision affects your account',
        body: dto.action === 'restore' ? undefined : `Action: ${dto.action.replace('_', ' ')}. Reason: ${dto.reason}. You can appeal this decision.`,
        data: { type: 'moderation_action', id: action.id },
        channels: ['push', 'email'],
      });
    }
    await this.audit.record(actor, { action: `moderation.${dto.action}`, targetType: dto.targetType, targetId: dto.targetId, subjectUserId: t.ownerId, metadata: { scope, reportId: dto.reportId ?? null }, asStaff: scope === 'platform' });
    return action;
  }

  // ------------------------------------------------------------------ appeals
  async myActions(actor: Actor) {
    return this.db
      .select({ id: moderationActions.id, targetType: moderationActions.targetType, targetId: moderationActions.targetId, action: moderationActions.action, reason: moderationActions.reason, expiresAt: moderationActions.expiresAt, createdAt: moderationActions.createdAt })
      .from(moderationActions)
      .where(and(eq(moderationActions.targetUserId, actor.userId), sql`${moderationActions.action} not in ('dismiss','restore')`))
      .orderBy(desc(moderationActions.createdAt));
  }

  async appeal(actor: Actor, actionId: string, statement: string) {
    const [a] = await this.db.select().from(moderationActions).where(eq(moderationActions.id, actionId));
    if (!a || a.targetUserId !== actor.userId || ['dismiss', 'restore'].includes(a.action)) throw notFound('Decision');
    if (Date.now() - a.createdAt.getTime() > 30 * 86_400_000) throw unprocessable('Appeals must be made within 30 days', 'appeal_window_closed');
    const ins = await this.db.insert(moderationAppeals).values({ actionId, appellantId: actor.userId, statement }).onConflictDoNothing().returning();
    if (!ins.length) throw conflict('You already appealed this decision', 'already_appealed');
    await this.audit.record(actor, { action: 'moderation.appealed', targetType: 'moderation_action', targetId: actionId });
    return ins[0];
  }

  async appeals(status = 'open') {
    return this.db
      .select({ appeal: moderationAppeals, action: moderationActions })
      .from(moderationAppeals)
      .innerJoin(moderationActions, eq(moderationActions.id, moderationAppeals.actionId))
      .where(eq(moderationAppeals.status, status as 'open'))
      .orderBy(asc(moderationAppeals.createdAt))
      .limit(200);
  }

  /** Separation of duties: the moderator who made the decision cannot decide its appeal. */
  async decideAppeal(actor: Actor, appealId: string, decision: 'upheld' | 'overturned', note: string) {
    const [row] = await this.db
      .select({ appeal: moderationAppeals, action: moderationActions })
      .from(moderationAppeals)
      .innerJoin(moderationActions, eq(moderationActions.id, moderationAppeals.actionId))
      .where(eq(moderationAppeals.id, appealId));
    if (!row) throw notFound('Appeal');
    if (row.appeal.status !== 'open') throw unprocessable('Appeal already decided');
    if (row.action.moderatorId === actor.userId) throw forbidden('A different moderator must decide this appeal', 'separation_of_duties');
    await this.db.update(moderationAppeals).set({ status: decision, decidedBy: actor.userId, decisionNote: note, decidedAt: new Date() }).where(eq(moderationAppeals.id, appealId));
    if (decision === 'overturned') {
      const a = row.action;
      if (a.targetType === 'post') await this.db.update(posts).set({ status: 'published', removedReason: null }).where(eq(posts.id, a.targetId));
      if (a.targetType === 'comment') await this.db.update(comments).set({ status: 'published' }).where(eq(comments.id, a.targetId));
      if (a.targetType === 'review') await this.db.update(providerReviews).set({ status: 'published' }).where(eq(providerReviews.id, a.targetId));
      await this.db.update(userSanctions).set({ liftedAt: new Date(), liftedBy: actor.userId }).where(eq(userSanctions.actionId, a.id));
      if (a.action === 'ban' && a.targetUserId) await this.db.update(users).set({ status: 'active', disabledReason: null }).where(eq(users.id, a.targetUserId));
    }
    await this.notifications.notify({
      userId: row.appeal.appellantId,
      category: 'community',
      template: 'appeal_decided',
      title: decision === 'overturned' ? 'Your appeal was accepted' : 'Your appeal was reviewed',
      body: note,
      data: { type: 'moderation_appeal', id: appealId },
      channels: ['push', 'email'],
    });
    await this.audit.record(actor, { action: `moderation.appeal_${decision}`, targetType: 'moderation_appeal', targetId: appealId, subjectUserId: row.appeal.appellantId, asStaff: true });
    return { id: appealId, status: decision };
  }

  async liftSanction(actor: Actor, sanctionId: string) {
    const [s] = await this.db.update(userSanctions).set({ liftedAt: new Date(), liftedBy: actor.userId }).where(and(eq(userSanctions.id, sanctionId), isNull(userSanctions.liftedAt))).returning();
    if (!s) throw notFound('Sanction');
    if (s.kind === 'banned') await this.db.update(users).set({ status: 'active', disabledReason: null }).where(eq(users.id, s.userId));
    await this.audit.record(actor, { action: 'moderation.sanction_lifted', targetType: 'user_sanction', targetId: sanctionId, subjectUserId: s.userId, asStaff: true });
    return s;
  }

  async moderationLog(q: CursorQuery) {
    const limit = lim(q);
    const rows = await this.db
      .select()
      .from(moderationActions)
      .where(keyset(moderationActions.createdAt, moderationActions.id, q.cursor))
      .orderBy(desc(moderationActions.createdAt), desc(moderationActions.id))
      .limit(limit + 1);
    return pageOf(rows, limit, (r) => [r.createdAt, r.id]);
  }

  /** Worker: purge expired evidence snapshots. */
  async purgeEvidence() {
    const res = await this.db.delete(contentSnapshots).where(lt(contentSnapshots.retainUntil, new Date())).returning({ id: contentSnapshots.id });
    return res.length;
  }
}
