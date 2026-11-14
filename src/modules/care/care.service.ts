import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { Actor } from '../../common/auth-context';
import { badRequest, notFound, unprocessable } from '../../common/errors';
import { GrantScope, PolicyService } from '../../common/policy.service';
import { addDays, localParts, zonedTimeToUtc } from '../../common/time';
import { Database, DB } from '../../db/db';
import {
  accessGrants,
  calendarEvents,
  careSuggestions,
  checkInEvents,
  checkInSchedules,
  contactInvitations,
  helpRequestRecipients,
  helpRequests,
  reminders,
  trustedContacts,
  userPreferences,
  userProfiles,
} from '../../db/schema';
import { CheckinsService } from '../checkins/checkins.service';
import { HelpService } from '../help/help.service';
import { InviteHelper } from '../households/households.service';
import { MeService } from '../me/me.service';
import { NotificationsService } from '../notifications/notifications.service';

/** What a caregiver may be given. Each one is still an ordinary, revocable grant with cooling-off. */
export const CARE_SCOPES: GrantScope[] = ['checkins.view', 'checkins.alerts', 'help.alerts', 'help.location', 'calendar.view', 'checkins.suggest'];

export type SuggestionKind = 'add_medicine';
export interface ProposeSuggestionInput {
  targetUserId: string;
  kind: SuggestionKind;
  name: string;
  times: string[];
}

/** Features a focused home hides. Nothing is deleted; they come back from Settings. */
export const FOCUS_HIDDEN: Record<'caregiver' | 'cared_for', string[]> = {
  caregiver: ['community', 'consumer', 'services', 'agents'],
  cared_for: ['community', 'consumer', 'services', 'agents', 'household'],
};

export interface SetupInput {
  checkInTime?: string | null;
  checkInLabel?: string;
  alertContactIds?: string[];
  consentToAlertContacts?: boolean;
  medicines?: { name: string; times: string[] }[];
  medicineAlerts?: boolean;
  primaryCallContactId?: string | null;
  largerText?: boolean;
  focus?: boolean;
}

type Status = 'help' | 'missed' | 'waiting' | 'ok' | 'quiet' | 'not_set_up' | 'starting';

/**
 * Family care in one place: a caregiver's view of the people who chose to share with them, and the simple
 * "my day" view for the person being looked after. Everything here reads through the existing grants, so a
 * caregiver sees exactly what was shared and nothing more.
 */
@Injectable()
export class CareService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly policy: PolicyService,
    private readonly checkins: CheckinsService,
    private readonly help: HelpService,
    private readonly me: MeService,
    private readonly notifications: NotificationsService,
    private readonly names: InviteHelper,
  ) {}

  private async dayRange(userId: string) {
    const [p] = await this.db.select({ tz: userProfiles.timezone }).from(userProfiles).where(eq(userProfiles.userId, userId));
    const tz = p?.tz || 'UTC';
    const l = localParts(new Date(), tz);
    const start = zonedTimeToUtc(l.year, l.month, l.day, 0, 0, tz);
    return { tz, start, end: addDays(start, 1) };
  }

  /** Today's check-ins and medicines: what already came due (with its state) plus what is still to come. */
  private async routine(userId: string) {
    const { start, end } = await this.dayRange(userId);
    const events = await this.db
      .select({ id: checkInEvents.id, scheduleId: checkInEvents.scheduleId, label: checkInSchedules.label, purpose: checkInSchedules.purpose, dueAt: checkInEvents.dueAt, state: checkInEvents.state, completedAt: checkInEvents.completedAt, acknowledgedAt: checkInEvents.acknowledgedAt })
      .from(checkInEvents)
      .innerJoin(checkInSchedules, eq(checkInSchedules.id, checkInEvents.scheduleId))
      .where(and(eq(checkInEvents.userId, userId), gte(checkInEvents.dueAt, start), lt(checkInEvents.dueAt, end), ne(checkInEvents.state, 'cancelled')))
      .orderBy(asc(checkInEvents.dueAt));
    const upcoming = await this.db
      .select({ scheduleId: checkInSchedules.id, label: checkInSchedules.label, purpose: checkInSchedules.purpose, dueAt: checkInSchedules.nextDueAt })
      .from(checkInSchedules)
      .where(and(eq(checkInSchedules.userId, userId), eq(checkInSchedules.active, true), gte(checkInSchedules.nextDueAt, new Date()), lt(checkInSchedules.nextDueAt, end)));
    const items = [
      ...events.map((e) => ({ ...e, upcoming: false })),
      ...upcoming
        .filter((u) => !events.some((e) => e.scheduleId === u.scheduleId && e.dueAt.getTime() === u.dueAt!.getTime()))
        .map((u) => ({ id: null as string | null, scheduleId: u.scheduleId, label: u.label, purpose: u.purpose, dueAt: u.dueAt!, state: 'upcoming' as string, completedAt: null as Date | null, acknowledgedAt: null as Date | null, upcoming: true })),
    ].sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());
    const schedules = await this.db
      .select({ id: checkInSchedules.id, label: checkInSchedules.label, purpose: checkInSchedules.purpose, timeLocal: checkInSchedules.timeLocal, nextDueAt: checkInSchedules.nextDueAt })
      .from(checkInSchedules)
      .where(and(eq(checkInSchedules.userId, userId), eq(checkInSchedules.active, true)))
      .orderBy(asc(checkInSchedules.timeLocal));
    return { items, activeSchedules: schedules.length, schedules: schedules.map((s) => ({ ...s, timeLocal: s.timeLocal?.slice(0, 5) ?? null })) };
  }

  private static status(items: { state: string; purpose: string }[], openHelp: number, schedules: number): Status {
    if (openHelp) return 'help';
    if (items.some((i) => i.state === 'missed' || i.state === 'escalated')) return 'missed';
    if (items.some((i) => i.state === 'pending' || i.state === 'reminded')) return 'waiting';
    if (items.some((i) => i.state === 'completed' || i.state === 'acknowledged')) return 'ok';
    return schedules ? 'quiet' : 'not_set_up';
  }

  // ------------------------------------------------------------------ caregiver
  /** Everyone who shares care information with me, each with only the parts they shared. */
  async people(actor: Actor) {
    const grants = await this.db
      .select({ grantorId: accessGrants.grantorId, scope: accessGrants.scope, status: accessGrants.status, effectiveAt: accessGrants.effectiveAt })
      .from(accessGrants)
      .where(and(eq(accessGrants.granteeId, actor.userId), inArray(accessGrants.scope, CARE_SCOPES), inArray(accessGrants.status, ['pending_cooloff', 'active'])));
    // Sharing only a calendar doesn't make someone a person you look after; check-ins or help alerts do.
    const ids = [...new Set(grants.filter((g) => g.scope !== 'calendar.view').map((g) => g.grantorId))];
    const out = [];
    for (const id of ids) {
      const mine = grants.filter((g) => g.grantorId === id);
      const live = (s: GrantScope) => mine.some((g) => g.scope === s && g.status === 'active');
      const [profile] = await this.db.select({ n: userProfiles.displayName }).from(userProfiles).where(eq(userProfiles.userId, id));
      const [tc] = await this.db.select({ label: trustedContacts.label }).from(trustedContacts).where(and(eq(trustedContacts.userId, actor.userId), eq(trustedContacts.contactUserId, id), isNull(trustedContacts.removedAt)));
      const seesCheckins = live('checkins.view') || live('checkins.alerts');
      const routine = seesCheckins ? await this.routine(id) : null;
      let lastCheckInAt: Date | null = null;
      if (seesCheckins) {
        const [last] = await this.db
          .select({ at: checkInEvents.completedAt })
          .from(checkInEvents)
          .innerJoin(checkInSchedules, eq(checkInSchedules.id, checkInEvents.scheduleId))
          .where(and(eq(checkInEvents.userId, id), eq(checkInEvents.state, 'completed'), eq(checkInSchedules.purpose, 'wellbeing')))
          .orderBy(desc(checkInEvents.completedAt))
          .limit(1);
        lastCheckInAt = last?.at ?? null;
      }
      const openHelp = live('help.alerts')
        ? await this.db
            .select({ id: helpRequests.id, kind: helpRequests.kind, message: helpRequests.message, status: helpRequests.status, createdAt: helpRequests.createdAt, acknowledgedAt: helpRequestRecipients.acknowledgedAt })
            .from(helpRequestRecipients)
            .innerJoin(helpRequests, eq(helpRequests.id, helpRequestRecipients.helpRequestId))
            .where(and(eq(helpRequestRecipients.recipientUserId, actor.userId), eq(helpRequests.userId, id), inArray(helpRequests.status, ['open', 'acknowledged'])))
            .orderBy(desc(helpRequests.createdAt))
        : [];
      const appointments = live('calendar.view')
        ? await this.db
            .select({ id: calendarEvents.id, title: calendarEvents.title, kind: calendarEvents.kind, startsAt: calendarEvents.startsAt, locationText: calendarEvents.locationText })
            .from(calendarEvents)
            .where(and(eq(calendarEvents.ownerUserId, id), eq(calendarEvents.visibility, 'shared'), isNull(calendarEvents.cancelledAt), gte(calendarEvents.startsAt, new Date()), lt(calendarEvents.startsAt, addDays(new Date(), 14))))
            .orderBy(asc(calendarEvents.startsAt))
            .limit(5)
        : [];
      const anyLive = mine.some((g) => g.status === 'active');
      out.push({
        userId: id,
        displayName: profile?.n ?? null,
        label: tc?.label ?? null,
        shares: mine.map((g) => ({ scope: g.scope, status: g.status, effectiveAt: g.effectiveAt })),
        status: (anyLive ? CareService.status(routine?.items ?? [], openHelp.length, routine?.activeSchedules ?? (seesCheckins ? 0 : 1)) : 'starting') as Status,
        today: routine?.items ?? null,
        lastCheckInAt,
        openHelp,
        appointments: live('calendar.view') ? appointments : null,
      });
    }
    const order: Status[] = ['help', 'missed', 'waiting', 'not_set_up', 'starting', 'quiet', 'ok'];
    out.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
    const waiting = await this.db
      .select({ id: contactInvitations.id, label: contactInvitations.label, requestedScopes: contactInvitations.requestedScopes, createdAt: contactInvitations.createdAt, expiresAt: contactInvitations.expiresAt })
      .from(contactInvitations)
      .where(and(eq(contactInvitations.inviterUserId, actor.userId), eq(contactInvitations.status, 'pending'), gt(contactInvitations.expiresAt, new Date()), sql`cardinality(${contactInvitations.requestedScopes}) > 0`))
      .orderBy(desc(contactInvitations.createdAt));
    return { people: out, invitations: waiting };
  }

  // ------------------------------------------------------------------ person being looked after
  /** The simple home: today's check-in and medicines, who gets told, who to call, and what's coming up. */
  async today(actor: Actor) {
    const routine = await this.routine(actor.userId);
    const circle = new Map<string, { userId: string; displayName: string | null; scopes: { scope: string; status: string; effectiveAt: Date }[] }>();
    const given = await this.db
      .select({ granteeId: accessGrants.granteeId, scope: accessGrants.scope, status: accessGrants.status, effectiveAt: accessGrants.effectiveAt, n: userProfiles.displayName })
      .from(accessGrants)
      .innerJoin(userProfiles, eq(userProfiles.userId, accessGrants.granteeId))
      .where(and(eq(accessGrants.grantorId, actor.userId), inArray(accessGrants.scope, CARE_SCOPES), inArray(accessGrants.status, ['pending_cooloff', 'active'])));
    for (const g of given) {
      const c = circle.get(g.granteeId) ?? { userId: g.granteeId, displayName: g.n, scopes: [] };
      c.scopes.push({ scope: g.scope, status: g.status, effectiveAt: g.effectiveAt });
      circle.set(g.granteeId, c);
    }
    const { end } = await this.dayRange(actor.userId);
    const todayReminders = await this.db
      .select({ id: reminders.id, title: reminders.title, fireAt: reminders.fireAt })
      .from(reminders)
      .where(and(eq(reminders.userId, actor.userId), eq(reminders.status, 'scheduled'), gte(reminders.fireAt, new Date()), lt(reminders.fireAt, addDays(end, 1))))
      .orderBy(asc(reminders.fireAt))
      .limit(5);
    const appointments = await this.db
      .select({ id: calendarEvents.id, title: calendarEvents.title, kind: calendarEvents.kind, startsAt: calendarEvents.startsAt, locationText: calendarEvents.locationText })
      .from(calendarEvents)
      .where(and(eq(calendarEvents.ownerUserId, actor.userId), isNull(calendarEvents.cancelledAt), gte(calendarEvents.startsAt, new Date()), lt(calendarEvents.startsAt, addDays(new Date(), 7))))
      .orderBy(asc(calendarEvents.startsAt))
      .limit(3);
    const help = await this.help.preferences(actor);
    const openHelp = await this.db.select({ id: helpRequests.id, createdAt: helpRequests.createdAt, status: helpRequests.status }).from(helpRequests).where(and(eq(helpRequests.userId, actor.userId), inArray(helpRequests.status, ['open', 'acknowledged']))).orderBy(desc(helpRequests.createdAt)).limit(1);
    return {
      today: routine.items,
      activeSchedules: routine.activeSchedules,
      /** Every active check-in and medicine, with when it next comes round (for "next: tomorrow 08:00"). */
      schedules: routine.schedules,
      circle: [...circle.values()],
      reminders: todayReminders,
      appointments,
      callTargets: help.callTargets,
      emergencyNumber: help.emergencyNumber,
      openHelp: openHelp[0] ?? null,
    };
  }

  /**
   * One-step setup for the person being looked after, from their own account: their daily check-in, their
   * medicines, who is told if one is missed, who to call first, larger text and a focused home.
   */
  async setup(actor: Actor, dto: SetupInput) {
    // Not given (e.g. just adding a medicine): the people who already receive this person's check-in alerts.
    const contacts = [
      ...new Set(
        dto.alertContactIds ??
          (
            await this.db
              .select({ id: accessGrants.granteeId })
              .from(accessGrants)
              .where(and(eq(accessGrants.grantorId, actor.userId), eq(accessGrants.scope, 'checkins.alerts'), inArray(accessGrants.status, ['pending_cooloff', 'active'])))
          ).map((r) => r.id),
      ),
    ];
    const meds = (dto.medicines ?? []).map((m) => ({ name: m.name.trim(), times: [...new Set(m.times)] })).filter((m) => m.name && m.times.length);
    if (meds.reduce((n, m) => n + m.times.length, 0) > 12) throw badRequest('Up to 12 medicine reminders a day', 'too_many_medicines');

    // Alerts can be wanted before anyone has accepted: record the consent now, and contacts are added as they accept.
    const wantsAlerts = contacts.length > 0 || !!dto.consentToAlertContacts;
    if (dto.consentToAlertContacts) await this.checkins.recordAlertConsent(actor);
    if (dto.checkInTime) {
      const existing = (await this.checkins.schedules(actor)).find((s) => s.purpose === 'wellbeing' && s.kind === 'daily');
      const body = { timeLocal: dto.checkInTime, escalate: wantsAlerts, escalationContactIds: contacts, consentToAlertContacts: dto.consentToAlertContacts, active: true };
      if (existing) await this.checkins.update(actor, existing.id, body);
      else await this.checkins.create(actor, { label: dto.checkInLabel?.trim() || 'Daily check-in', kind: 'daily', purpose: 'wellbeing', ...body });
    }
    for (const m of meds) {
      for (const time of m.times) {
        const alerts = !!dto.medicineAlerts && wantsAlerts;
        await this.checkins.create(actor, {
          label: m.name,
          kind: 'daily',
          purpose: 'medicine',
          timeLocal: time,
          reminderAfterMinutes: 20,
          graceMinutes: 40,
          escalate: alerts,
          escalationContactIds: alerts ? contacts : [],
          consentToAlertContacts: dto.consentToAlertContacts,
        });
      }
    }
    if (dto.primaryCallContactId !== undefined) await this.help.updatePreferences(actor, { primaryCallContactId: dto.primaryCallContactId, notifyContacts: true });
    if (dto.largerText !== undefined) await this.me.updateProfile(actor, { seniorMode: dto.largerText });
    await this.setMode(actor, 'cared_for', dto.focus ?? true);
    return this.today(actor);
  }

  /** Choose what the home screen is for. With focus on, unrelated features are hidden (and can be turned back on). */
  async setMode(actor: Actor, mode: 'standard' | 'caregiver' | 'cared_for', focus = true) {
    const [p] = await this.db.select({ off: userPreferences.disabledFeatures, mode: userPreferences.homeMode }).from(userPreferences).where(eq(userPreferences.userId, actor.userId));
    const current = p?.off ?? [];
    // Choosing "everything" without having been in a focused home leaves the person's own feature switches alone.
    if (mode === 'standard' && (!p?.mode || p.mode === 'standard')) return this.me.updatePreferences(actor, { homeMode: mode });
    const focusable = new Set([...FOCUS_HIDDEN.caregiver, ...FOCUS_HIDDEN.cared_for]);
    // Features a focused home hides are reset on every change of mode, so leaving focus brings them back.
    const base = current.filter((f) => !focusable.has(f));
    let final = mode !== 'standard' && focus ? [...new Set([...base, ...FOCUS_HIDDEN[mode]])] : base;
    // Family care is what both care modes are built on.
    if (mode !== 'standard') final = final.filter((f) => f !== 'familycare');
    return this.me.updatePreferences(actor, { homeMode: mode, disabledFeatures: final });
  }

  // ------------------------------------------------------------------ suggestions
  private suggestionView(row: typeof careSuggestions.$inferSelect) {
    return { id: row.id, targetUserId: row.targetUserId, proposedBy: row.proposedBy, kind: row.kind, payload: row.payload as { name: string; times: string[] }, status: row.status, createdAt: row.createdAt, decidedAt: row.decidedAt };
  }

  /**
   * A caregiver proposes adding a medicine reminder for someone who granted them checkins.suggest. Nothing about
   * the parent's schedule changes here — it only takes effect once the parent reviews it in `decide`.
   */
  async propose(actor: Actor, dto: ProposeSuggestionInput) {
    if (actor.userId === dto.targetUserId) throw badRequest('Propose this for someone else, not yourself', 'self_suggestion');
    await this.policy.requireGrant(actor.userId, dto.targetUserId, 'checkins.suggest', 'Person');
    if (dto.kind !== 'add_medicine') throw badRequest(`Unsupported suggestion kind ${dto.kind}`, 'unsupported_kind');
    const name = dto.name.trim();
    const times = [...new Set(dto.times)];
    if (!name || !times.length) throw badRequest('A medicine needs a name and at least one time', 'invalid_payload');
    const [row] = await this.db
      .insert(careSuggestions)
      .values({ targetUserId: dto.targetUserId, proposedBy: actor.userId, kind: dto.kind, payload: { name, times } })
      .returning();
    const proposerName = await this.names.displayName(actor.userId);
    await this.notifications.notify({
      userId: dto.targetUserId,
      category: 'checkins',
      template: 'care_suggestion_proposed',
      title: `${proposerName} suggests adding "${name}" to your reminders`,
      body: 'Nothing changes until you approve it.',
      data: { type: 'care_suggestion', id: row.id },
      channels: ['push'],
    });
    return this.suggestionView(row);
  }

  /** Suggestions about me (to decide) and suggestions I made (to track), each with the other person's name. */
  async suggestions(actor: Actor) {
    const rows = await this.db
      .select()
      .from(careSuggestions)
      .where(or(eq(careSuggestions.targetUserId, actor.userId), eq(careSuggestions.proposedBy, actor.userId)))
      .orderBy(desc(careSuggestions.createdAt))
      .limit(100);
    const ids = [...new Set(rows.flatMap((r) => [r.targetUserId, r.proposedBy]))];
    const names = ids.length ? await this.db.select({ id: userProfiles.userId, n: userProfiles.displayName }).from(userProfiles).where(inArray(userProfiles.userId, ids)) : [];
    const nameOf = (id: string) => names.find((n) => n.id === id)?.n ?? null;
    return {
      forMe: rows.filter((r) => r.targetUserId === actor.userId).map((r) => ({ ...this.suggestionView(r), proposedByName: nameOf(r.proposedBy) })),
      byMe: rows.filter((r) => r.proposedBy === actor.userId).map((r) => ({ ...this.suggestionView(r), targetName: nameOf(r.targetUserId) })),
    };
  }

  /** Only the person a suggestion is about may decide it — never the caregiver who proposed it, never anyone else. */
  async decide(actor: Actor, id: string, decision: 'approved' | 'declined') {
    const [row] = await this.db.select().from(careSuggestions).where(eq(careSuggestions.id, id));
    if (!row || row.targetUserId !== actor.userId) throw notFound('Suggestion');
    if (row.status !== 'pending') throw unprocessable('This suggestion was already decided', 'already_decided');
    let resultScheduleId: string | null = null;
    if (decision === 'approved' && row.kind === 'add_medicine') {
      const payload = row.payload as { name: string; times: string[] };
      // Same shape as care/setup: one daily schedule per time, alerts off until the parent turns them on themselves.
      for (const time of payload.times) {
        const created = await this.checkins.create(actor, { label: payload.name, kind: 'daily', purpose: 'medicine', timeLocal: time, reminderAfterMinutes: 20, graceMinutes: 40, escalate: false });
        resultScheduleId ??= created?.id ?? null;
      }
    }
    const [updated] = await this.db
      .update(careSuggestions)
      .set({ status: decision, decidedBy: actor.userId, decidedAt: new Date(), resultScheduleId })
      .where(eq(careSuggestions.id, id))
      .returning();
    const deciderName = await this.names.displayName(actor.userId);
    await this.notifications.notify({
      userId: row.proposedBy,
      category: 'checkins',
      template: 'care_suggestion_decided',
      title: decision === 'approved' ? `${deciderName} approved your suggestion` : `${deciderName} declined your suggestion`,
      data: { type: 'care_suggestion', id },
      channels: ['push'],
    });
    return this.suggestionView(updated);
  }
}
