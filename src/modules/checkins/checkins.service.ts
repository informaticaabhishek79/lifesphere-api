import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm';
import { AuditService } from '../../common/audit.service';
import { Actor } from '../../common/auth-context';
import { AppError, badRequest, notFound, unprocessable } from '../../common/errors';
import { PolicyService } from '../../common/policy.service';
import { addDays, addMinutes, isValidTimeZone, localParts, parseHHMM, zonedTimeToUtc } from '../../common/time';
import { Database, DB } from '../../db/db';
import { accessGrants, alertDeliveries, checkInEscalationContacts, checkInEvents, checkInSchedules, consentRecords, userProfiles } from '../../db/schema';
import { InviteHelper } from '../households/households.service';
import { NotificationsService } from '../notifications/notifications.service';

type Schedule = typeof checkInSchedules.$inferSelect;
export type CheckInKind = 'daily' | 'weekly' | 'one_off' | 'visit_confirmation' | 'assistance_confirmation';

export interface ScheduleInput {
  label: string;
  kind: CheckInKind;
  timeLocal?: string;
  daysOfWeek?: number[];
  oneOffAt?: string;
  timezone?: string;
  reminderAfterMinutes?: number;
  graceMinutes?: number;
  escalate?: boolean;
  escalationContactIds?: string[];
  /** Explicit, purpose-specific consent to alert contacts when a check-in is missed. */
  consentToAlertContacts?: boolean;
  active?: boolean;
}

/** Compute the next due instant strictly after `after` for a schedule. */
export function computeNextDue(s: Pick<Schedule, 'kind' | 'timeLocal' | 'daysOfWeek' | 'oneOffAt' | 'timezone'>, after: Date): Date | null {
  if (s.kind === 'one_off' || s.kind === 'visit_confirmation' || s.kind === 'assistance_confirmation') {
    return s.oneOffAt && s.oneOffAt > after ? s.oneOffAt : null;
  }
  if (!s.timeLocal) return null;
  const { h, m } = parseHHMM(s.timeLocal);
  const p = localParts(after, s.timezone);
  for (let i = 0; i <= 8; i++) {
    const day = new Date(Date.UTC(p.year, p.month - 1, p.day + i));
    const dow = day.getUTCDay();
    if (s.kind === 'weekly' && !(s.daysOfWeek ?? []).includes(dow)) continue;
    const candidate = zonedTimeToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), h, m, s.timezone);
    if (candidate > after) return candidate;
  }
  return null;
}

/**
 * Wellbeing check-ins. A missed check-in is never treated as an emergency: the user is reminded, then after the grace
 * period the contacts they chose (who hold a checkins.alerts grant) are told, and anyone can acknowledge.
 */
@Injectable()
export class CheckinsService {
  private readonly logger = new Logger('CheckIns');

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly names: InviteHelper,
  ) {}

  private validate(dto: Partial<ScheduleInput>, existing?: Schedule) {
    const kind = dto.kind ?? existing?.kind;
    if (dto.timezone && !isValidTimeZone(dto.timezone)) throw badRequest('Unknown time zone', 'invalid_timezone');
    if (kind === 'daily' || kind === 'weekly') {
      if (!(dto.timeLocal ?? existing?.timeLocal)) throw badRequest('timeLocal is required (HH:MM)', 'time_required');
    }
    if (kind === 'weekly' && !(dto.daysOfWeek ?? existing?.daysOfWeek)?.length) throw badRequest('Choose at least one day', 'days_required');
    if (kind && !['daily', 'weekly'].includes(kind)) {
      const at = dto.oneOffAt ? new Date(dto.oneOffAt) : existing?.oneOffAt;
      if (!at) throw badRequest('oneOffAt is required for one-off check-ins', 'time_required');
      if (dto.oneOffAt && at < new Date()) throw badRequest('Time is in the past', 'time_in_past');
    }
  }

  private async validateContacts(actor: Actor, ids: string[]) {
    for (const id of ids) {
      const [g] = await this.db
        .select({ id: accessGrants.id })
        .from(accessGrants)
        .where(and(eq(accessGrants.grantorId, actor.userId), eq(accessGrants.granteeId, id), eq(accessGrants.scope, 'checkins.alerts'), inArray(accessGrants.status, ['pending_cooloff', 'active'])))
        .limit(1);
      if (!g) throw new AppError(422, 'grant_required', 'Each alert contact must first be given "get alerts when you miss a check-in" in Sharing.');
    }
  }

  private async ensureConsent(actor: Actor, dto: Partial<ScheduleInput>, escalate: boolean) {
    if (!escalate) return;
    const [c] = await this.db
      .select({ id: consentRecords.id })
      .from(consentRecords)
      .where(and(eq(consentRecords.userId, actor.userId), eq(consentRecords.purpose, 'checkins_sharing'), isNull(consentRecords.withdrawnAt)))
      .limit(1);
    if (c) return;
    if (!dto.consentToAlertContacts) {
      throw new AppError(422, 'consent_required', 'Confirm that your chosen contacts may be alerted when you miss a check-in (consentToAlertContacts: true).');
    }
    await this.db.insert(consentRecords).values({ userId: actor.userId, purpose: 'checkins_sharing', policyVersion: 'checkins-v1' }).onConflictDoNothing();
    await this.audit.record(actor, { action: 'consent.granted', targetType: 'consent', subjectUserId: actor.userId, metadata: { purpose: 'checkins_sharing' } });
  }

  async schedules(actor: Actor) {
    const rows = await this.db.select().from(checkInSchedules).where(eq(checkInSchedules.userId, actor.userId)).orderBy(asc(checkInSchedules.createdAt));
    const ids = rows.map((r) => r.id);
    const contacts = ids.length
      ? await this.db
          .select({ scheduleId: checkInEscalationContacts.scheduleId, userId: checkInEscalationContacts.contactUserId, displayName: userProfiles.displayName, position: checkInEscalationContacts.position })
          .from(checkInEscalationContacts)
          .innerJoin(userProfiles, eq(userProfiles.userId, checkInEscalationContacts.contactUserId))
          .where(inArray(checkInEscalationContacts.scheduleId, ids))
      : [];
    return rows.map((r) => ({ ...r, timeLocal: r.timeLocal?.slice(0, 5) ?? null, escalationContacts: contacts.filter((c) => c.scheduleId === r.id).sort((a, b) => a.position - b.position) }));
  }

  async create(actor: Actor, dto: ScheduleInput) {
    this.validate(dto);
    const escalate = dto.escalate ?? !!dto.escalationContactIds?.length;
    await this.validateContacts(actor, dto.escalationContactIds ?? []);
    await this.ensureConsent(actor, dto, escalate && !!dto.escalationContactIds?.length);
    const [profile] = await this.db.select({ tz: userProfiles.timezone }).from(userProfiles).where(eq(userProfiles.userId, actor.userId));
    const base = {
      kind: dto.kind,
      timeLocal: dto.timeLocal ?? null,
      daysOfWeek: dto.daysOfWeek ?? null,
      oneOffAt: dto.oneOffAt ? new Date(dto.oneOffAt) : null,
      timezone: dto.timezone ?? profile?.tz ?? 'Asia/Kolkata',
    };
    const [s] = await this.db
      .insert(checkInSchedules)
      .values({
        userId: actor.userId,
        label: dto.label,
        ...base,
        reminderAfterMinutes: dto.reminderAfterMinutes ?? 15,
        graceMinutes: dto.graceMinutes ?? 30,
        escalate,
        active: dto.active ?? true,
        nextDueAt: computeNextDue(base, new Date()),
      })
      .returning();
    await this.setContacts(s.id, dto.escalationContactIds ?? []);
    await this.audit.record(actor, { action: 'checkin.schedule_created', targetType: 'check_in_schedule', targetId: s.id, subjectUserId: actor.userId, metadata: { escalate, contacts: dto.escalationContactIds?.length ?? 0 } });
    return (await this.schedules(actor)).find((x) => x.id === s.id);
  }

  private async setContacts(scheduleId: string, ids: string[]) {
    await this.db.delete(checkInEscalationContacts).where(eq(checkInEscalationContacts.scheduleId, scheduleId));
    if (ids.length) {
      await this.db.insert(checkInEscalationContacts).values([...new Set(ids)].map((contactUserId, position) => ({ scheduleId, contactUserId, position })));
    }
  }

  private async own(actor: Actor, id: string) {
    const [s] = await this.db.select().from(checkInSchedules).where(and(eq(checkInSchedules.id, id), eq(checkInSchedules.userId, actor.userId)));
    if (!s) throw notFound('Check-in schedule');
    return s;
  }

  async update(actor: Actor, id: string, dto: Partial<ScheduleInput>) {
    const s = await this.own(actor, id);
    this.validate(dto, s);
    if (dto.escalationContactIds) await this.validateContacts(actor, dto.escalationContactIds);
    const escalate = dto.escalate ?? s.escalate;
    await this.ensureConsent(actor, dto, escalate && (dto.escalationContactIds?.length ?? 1) > 0);
    const next = {
      kind: dto.kind ?? s.kind,
      timeLocal: dto.timeLocal ?? s.timeLocal,
      daysOfWeek: dto.daysOfWeek ?? s.daysOfWeek,
      oneOffAt: dto.oneOffAt ? new Date(dto.oneOffAt) : s.oneOffAt,
      timezone: dto.timezone ?? s.timezone,
    };
    const active = dto.active ?? s.active;
    await this.db
      .update(checkInSchedules)
      .set({
        ...next,
        label: dto.label ?? s.label,
        reminderAfterMinutes: dto.reminderAfterMinutes ?? s.reminderAfterMinutes,
        graceMinutes: dto.graceMinutes ?? s.graceMinutes,
        escalate,
        active,
        nextDueAt: active ? computeNextDue(next, new Date()) : null,
      })
      .where(eq(checkInSchedules.id, id));
    if (dto.escalationContactIds) await this.setContacts(id, dto.escalationContactIds);
    await this.audit.record(actor, { action: 'checkin.schedule_updated', targetType: 'check_in_schedule', targetId: id, subjectUserId: actor.userId });
    return (await this.schedules(actor)).find((x) => x.id === id);
  }

  async remove(actor: Actor, id: string) {
    await this.own(actor, id);
    await this.db.delete(checkInSchedules).where(eq(checkInSchedules.id, id));
    await this.audit.record(actor, { action: 'checkin.schedule_deleted', targetType: 'check_in_schedule', targetId: id, subjectUserId: actor.userId });
  }

  // ------------------------------------------------------------------ events
  /** Check-ins visible to the actor: their own, or those of people who granted checkins.view / checkins.alerts. */
  private async canSeeUser(actor: Actor, userId: string) {
    if (userId === actor.userId) return true;
    return (await this.policy.hasGrant(actor.userId, userId, 'checkins.view')) || (await this.policy.hasGrant(actor.userId, userId, 'checkins.alerts'));
  }

  async events(actor: Actor, q: { userId?: string; from?: string; to?: string }) {
    const userId = q.userId ?? actor.userId;
    if (!(await this.canSeeUser(actor, userId))) throw notFound('Check-ins');
    const from = q.from ? new Date(q.from) : addDays(new Date(), -7);
    const to = q.to ? new Date(q.to) : addDays(new Date(), 1);
    return this.db
      .select({ id: checkInEvents.id, scheduleId: checkInEvents.scheduleId, label: checkInSchedules.label, dueAt: checkInEvents.dueAt, state: checkInEvents.state, completedAt: checkInEvents.completedAt, escalatedAt: checkInEvents.escalatedAt, acknowledgedAt: checkInEvents.acknowledgedAt, note: checkInEvents.note })
      .from(checkInEvents)
      .innerJoin(checkInSchedules, eq(checkInSchedules.id, checkInEvents.scheduleId))
      .where(and(eq(checkInEvents.userId, userId), gte(checkInEvents.dueAt, from), lte(checkInEvents.dueAt, to)))
      .orderBy(desc(checkInEvents.dueAt))
      .limit(500);
  }

  /** People who share their check-ins with me, with their latest state. */
  async people(actor: Actor) {
    const ids = [...new Set([...(await this.policy.grantorsOf(actor.userId, 'checkins.view')), ...(await this.policy.grantorsOf(actor.userId, 'checkins.alerts'))])];
    if (!ids.length) return [];
    const names = await this.db.select({ id: userProfiles.userId, n: userProfiles.displayName }).from(userProfiles).where(inArray(userProfiles.userId, ids));
    const out = [];
    for (const id of ids) {
      const [last] = await this.db
        .select({ id: checkInEvents.id, dueAt: checkInEvents.dueAt, state: checkInEvents.state, completedAt: checkInEvents.completedAt })
        .from(checkInEvents)
        .where(and(eq(checkInEvents.userId, id), lte(checkInEvents.dueAt, new Date())))
        .orderBy(desc(checkInEvents.dueAt))
        .limit(1);
      out.push({ userId: id, displayName: names.find((x) => x.id === id)?.n ?? null, latest: last ?? null, receivesAlerts: await this.policy.hasGrant(actor.userId, id, 'checkins.alerts') });
    }
    return out;
  }

  async event(actor: Actor, id: string) {
    const [e] = await this.db.select().from(checkInEvents).where(eq(checkInEvents.id, id));
    if (!e || !(await this.canSeeUser(actor, e.userId))) throw notFound('Check-in');
    const alerts = await this.db
      .select({ recipientUserId: alertDeliveries.recipientUserId, notificationJobId: alertDeliveries.notificationJobId, displayName: userProfiles.displayName })
      .from(alertDeliveries)
      .innerJoin(userProfiles, eq(userProfiles.userId, alertDeliveries.recipientUserId))
      .where(and(eq(alertDeliveries.alertType, 'check_in_missed'), eq(alertDeliveries.alertId, id)));
    const jobs = await this.notifications.jobsFor('check_in_event', [id]);
    return {
      ...e,
      // Delivery status comes only from providers: 'queued' and 'sent' do not mean the person saw it.
      alertDeliveries: alerts.map((a) => ({
        recipientUserId: a.recipientUserId,
        displayName: a.displayName,
        channels: jobs.filter((j) => j.userId === a.recipientUserId).map((j) => ({ channel: j.channel, status: j.status, sentAt: j.sentAt, deliveredAt: j.deliveredAt })),
      })),
    };
  }

  /** "I'm OK": completes the given event, or with no id, the most recent open check-in of today. */
  async complete(actor: Actor, eventId?: string, note?: string) {
    let e: typeof checkInEvents.$inferSelect | undefined;
    if (eventId) {
      [e] = await this.db.select().from(checkInEvents).where(and(eq(checkInEvents.id, eventId), eq(checkInEvents.userId, actor.userId)));
      if (!e) throw notFound('Check-in');
    } else {
      [e] = await this.db
        .select()
        .from(checkInEvents)
        .where(
          and(
            eq(checkInEvents.userId, actor.userId),
            inArray(checkInEvents.state, ['pending', 'reminded', 'missed', 'escalated']),
            gte(checkInEvents.dueAt, addDays(new Date(), -1)),
            lte(checkInEvents.dueAt, addMinutes(new Date(), 120)),
          ),
        )
        .orderBy(desc(checkInEvents.dueAt))
        .limit(1);
      if (!e) return { status: 'no_open_check_in', message: 'Nothing to check in for right now. Thank you!' };
    }
    if (e.state === 'completed') return { status: 'already_completed', event: e };
    const wasEscalated = e.state === 'escalated';
    const [u] = await this.db
      .update(checkInEvents)
      .set({ state: 'completed', completedAt: new Date(), note: note ?? e.note })
      .where(eq(checkInEvents.id, e.id))
      .returning();
    if (wasEscalated) {
      const recipients = await this.db.select({ u: alertDeliveries.recipientUserId }).from(alertDeliveries).where(and(eq(alertDeliveries.alertType, 'check_in_missed'), eq(alertDeliveries.alertId, e.id)));
      const name = await this.names.displayName(actor.userId);
      for (const r of recipients) {
        await this.notifications.notify({ userId: r.u, category: 'checkins', template: 'checkin_late_ok', title: `${name} has now checked in`, data: { type: 'check_in_event', id: e.id }, channels: ['push', 'sms'], critical: true, smsText: `LifeSphere: ${name} has now checked in` });
      }
    }
    return { status: 'completed', event: u };
  }

  /** A contact (or the user) acknowledges a missed/escalated check-in, e.g. after calling. */
  async acknowledge(actor: Actor, id: string, note?: string) {
    const [e] = await this.db.select().from(checkInEvents).where(eq(checkInEvents.id, id));
    if (!e) throw notFound('Check-in');
    const allowed = e.userId === actor.userId || (await this.policy.hasGrant(actor.userId, e.userId, 'checkins.alerts'));
    if (!allowed) throw notFound('Check-in');
    if (!['missed', 'escalated'].includes(e.state)) throw unprocessable('Only missed check-ins can be acknowledged', 'not_missed');
    const [u] = await this.db
      .update(checkInEvents)
      .set({ state: 'acknowledged', acknowledgedBy: actor.userId, acknowledgedAt: new Date(), note: note ?? e.note })
      .where(eq(checkInEvents.id, id))
      .returning();
    const others = await this.db.select({ u: alertDeliveries.recipientUserId }).from(alertDeliveries).where(and(eq(alertDeliveries.alertType, 'check_in_missed'), eq(alertDeliveries.alertId, id)));
    const name = await this.names.displayName(actor.userId);
    for (const r of [...others.map((o) => o.u), e.userId].filter((x) => x !== actor.userId)) {
      await this.notifications.notify({ userId: r, category: 'checkins', template: 'checkin_acknowledged', title: `${name} is following up on the missed check-in`, body: note, data: { type: 'check_in_event', id } });
    }
    await this.audit.record(actor, { action: 'checkin.acknowledged', targetType: 'check_in_event', targetId: id, subjectUserId: e.userId });
    return u;
  }

  // ------------------------------------------------------------------ engine (worker, every minute)
  async tick(now = new Date()) {
    let created = 0;
    let reminded = 0;
    let escalated = 0;

    // 1. Materialise due events and prompt the user.
    const due = await this.db
      .select()
      .from(checkInSchedules)
      .where(and(eq(checkInSchedules.active, true), isNotNull(checkInSchedules.nextDueAt), lte(checkInSchedules.nextDueAt, now)))
      .limit(500);
    for (const s of due) {
      const ins = await this.db.insert(checkInEvents).values({ scheduleId: s.id, userId: s.userId, dueAt: s.nextDueAt! }).onConflictDoNothing().returning();
      const next = computeNextDue(s, now);
      await this.db
        .update(checkInSchedules)
        .set({ nextDueAt: next, active: next ? s.active : s.kind === 'daily' || s.kind === 'weekly' })
        .where(eq(checkInSchedules.id, s.id));
      if (ins.length) {
        created++;
        await this.notifications.notify({
          userId: s.userId,
          category: 'checkins',
          template: 'checkin_prompt',
          title: `${s.label}: tap "I'm OK" to check in`,
          data: { type: 'check_in_event', id: ins[0].id },
          channels: ['push'],
          related: { type: 'check_in_event', id: ins[0].id },
        });
      }
    }

    // 2. Remind the user after reminderAfterMinutes.
    const toRemind = await this.db
      .select({ e: checkInEvents, s: checkInSchedules })
      .from(checkInEvents)
      .innerJoin(checkInSchedules, eq(checkInSchedules.id, checkInEvents.scheduleId))
      .where(and(eq(checkInEvents.state, 'pending'), lte(sql`${checkInEvents.dueAt} + make_interval(mins => ${checkInSchedules.reminderAfterMinutes})`, now)))
      .limit(500);
    for (const { e, s } of toRemind) {
      const upd = await this.db.update(checkInEvents).set({ state: 'reminded', remindedAt: now }).where(and(eq(checkInEvents.id, e.id), eq(checkInEvents.state, 'pending'))).returning();
      if (!upd.length) continue;
      reminded++;
      await this.notifications.notify({
        userId: e.userId,
        category: 'checkins',
        template: 'checkin_reminder',
        title: `Reminder: ${s.label} — please check in`,
        body: s.escalate ? `If we don't hear from you in ${s.graceMinutes} minutes, we'll let your chosen contacts know.` : undefined,
        data: { type: 'check_in_event', id: e.id },
        channels: ['push', 'sms'],
        critical: true,
        smsText: `LifeSphere: please open the app and tap I'm OK for ${s.label}`.slice(0, 120),
        related: { type: 'check_in_event', id: e.id },
      });
    }

    // 3. After the grace period: mark missed, and escalate to consenting contacts with a live checkins.alerts grant.
    const toMiss = await this.db
      .select({ e: checkInEvents, s: checkInSchedules })
      .from(checkInEvents)
      .innerJoin(checkInSchedules, eq(checkInSchedules.id, checkInEvents.scheduleId))
      .where(and(eq(checkInEvents.state, 'reminded'), lte(sql`${checkInEvents.remindedAt} + make_interval(mins => ${checkInSchedules.graceMinutes})`, now)))
      .limit(500);
    for (const { e, s } of toMiss) {
      const upd = await this.db.update(checkInEvents).set({ state: 'missed', missedAt: now }).where(and(eq(checkInEvents.id, e.id), eq(checkInEvents.state, 'reminded'))).returning();
      if (!upd.length) continue;
      const [consent] = await this.db
        .select({ id: consentRecords.id })
        .from(consentRecords)
        .where(and(eq(consentRecords.userId, e.userId), eq(consentRecords.purpose, 'checkins_sharing'), isNull(consentRecords.withdrawnAt)))
        .limit(1);
      if (!s.escalate || !consent) continue;
      const configured = await this.db.select().from(checkInEscalationContacts).where(eq(checkInEscalationContacts.scheduleId, s.id)).orderBy(asc(checkInEscalationContacts.position));
      const recipients: string[] = [];
      for (const c of configured) if (await this.policy.hasGrant(c.contactUserId, e.userId, 'checkins.alerts')) recipients.push(c.contactUserId);
      if (!recipients.length) continue;
      const name = await this.names.displayName(e.userId);
      for (const r of recipients) {
        const res = await this.notifications.notify({
          userId: r,
          category: 'checkins',
          template: 'checkin_missed_alert',
          title: `${name} missed their check-in (${s.label})`,
          body: 'This does not necessarily mean something is wrong. Please try to reach them, then mark that you are following up.',
          data: { type: 'check_in_event', id: e.id },
          channels: ['push', 'sms'],
          critical: true,
          smsText: `LifeSphere: ${name} missed a check-in. Please try to reach them.`.slice(0, 120),
          related: { type: 'check_in_event', id: e.id },
        });
        const jobs = res.jobs.length ? res.jobs : [{ id: null as string | null }];
        for (const j of jobs) await this.db.insert(alertDeliveries).values({ alertType: 'check_in_missed', alertId: e.id, recipientUserId: r, notificationJobId: j.id });
      }
      await this.db.update(checkInEvents).set({ state: 'escalated', escalatedAt: now }).where(eq(checkInEvents.id, e.id));
      await this.notifications.notify({
        userId: e.userId,
        category: 'checkins',
        template: 'checkin_escalated_self',
        title: 'We let your contacts know you missed a check-in',
        body: "Tap I'm OK to let them know you're fine.",
        data: { type: 'check_in_event', id: e.id },
        channels: ['push'],
        critical: true,
      });
      await this.audit.system({ action: 'checkin.escalated', targetType: 'check_in_event', targetId: e.id, subjectUserId: e.userId, metadata: { recipients: recipients.length } });
      escalated++;
    }
    return { created, reminded, escalated };
  }
}

void or;
void lt;
