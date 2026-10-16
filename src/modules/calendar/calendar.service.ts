import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, ne, or } from 'drizzle-orm';
import { AuditService } from '../../common/audit.service';
import { Actor } from '../../common/auth-context';
import { badRequest, notFound } from '../../common/errors';
import { PolicyService } from '../../common/policy.service';
import { normalizeRule, occurrencesBetween, parseRule } from '../../common/recurrence';
import { Database, DB } from '../../db/db';
import { calendarEvents, eventAttendees, userProfiles } from '../../db/schema';
import { InviteHelper } from '../households/households.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RemindersService } from '../reminders/reminders.service';

type Event = typeof calendarEvents.$inferSelect;
export type EventKind = 'appointment' | 'visit' | 'errand' | 'activity' | 'other';

export interface CreateEventInput {
  title: string;
  description?: string;
  kind?: EventKind;
  startsAt: string;
  endsAt?: string;
  allDay?: boolean;
  locationText?: string;
  recurrenceRule?: string;
  householdId?: string;
  visibility?: 'private' | 'household' | 'shared';
  attendeeUserIds?: string[];
  visitForUserId?: string;
  reminderMinutesBefore?: number;
}

@Injectable()
export class CalendarService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly reminders: RemindersService,
    private readonly notifications: NotificationsService,
    private readonly people: InviteHelper,
  ) {}

  /** People you may invite or schedule a visit with: household co-members and trusted contacts (either direction). */
  private async canInvolve(actor: Actor, userId: string) {
    if (userId === actor.userId) return true;
    return (
      (await this.policy.shareHousehold(actor.userId, userId)) ||
      (await this.policy.isTrustedContact(actor.userId, userId)) ||
      (await this.policy.isTrustedContact(userId, actor.userId))
    );
  }

  async canView(actor: Actor, e: Event) {
    if (e.ownerUserId === actor.userId || e.visitForUserId === actor.userId) return true;
    if (e.householdId && e.visibility !== 'private' && (await this.policy.householdRole(actor.userId, e.householdId))) return true;
    if (e.visibility === 'shared' && (await this.policy.hasGrant(actor.userId, e.ownerUserId, 'calendar.view'))) return true;
    const [a] = await this.db
      .select({ u: eventAttendees.userId })
      .from(eventAttendees)
      .where(and(eq(eventAttendees.eventId, e.id), eq(eventAttendees.userId, actor.userId)))
      .limit(1);
    return !!a;
  }

  private async canEdit(actor: Actor, e: Event) {
    if (e.ownerUserId === actor.userId) return true;
    return !!e.householdId && (await this.policy.householdRole(actor.userId, e.householdId)) === 'admin';
  }

  private async load(id: string) {
    const [e] = await this.db.select().from(calendarEvents).where(eq(calendarEvents.id, id));
    if (!e) throw notFound('Event');
    return e;
  }

  async create(actor: Actor, dto: CreateEventInput) {
    const startsAt = new Date(dto.startsAt);
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    if (endsAt && endsAt < startsAt) throw badRequest('End must be after start', 'invalid_range');
    if (dto.householdId) await this.policy.requireHouseholdMember(actor.userId, dto.householdId);
    const visibility = dto.visibility ?? (dto.householdId ? 'household' : 'private');
    if (visibility === 'household' && !dto.householdId) throw badRequest("Use visibility 'household' only with a household", 'invalid_visibility');
    let rule: string | null = null;
    if (dto.recurrenceRule) {
      parseRule(dto.recurrenceRule, startsAt);
      rule = normalizeRule(dto.recurrenceRule);
    }
    const kind = dto.kind ?? (dto.visitForUserId ? 'visit' : 'other');
    if (dto.visitForUserId && !(await this.canInvolve(actor, dto.visitForUserId))) throw notFound('Person');
    const attendees = new Set(dto.attendeeUserIds ?? []);
    if (dto.visitForUserId && dto.visitForUserId !== actor.userId) attendees.add(dto.visitForUserId);
    attendees.delete(actor.userId);
    for (const u of attendees) if (!(await this.canInvolve(actor, u))) throw notFound('Person');

    const e = await this.db.transaction(async (tx) => {
      const [ev] = await tx
        .insert(calendarEvents)
        .values({
          ownerUserId: actor.userId,
          householdId: dto.householdId ?? null,
          kind,
          title: dto.title,
          description: dto.description,
          startsAt,
          endsAt,
          allDay: dto.allDay ?? false,
          locationText: dto.locationText,
          recurrenceRule: rule,
          visibility,
          visitForUserId: dto.visitForUserId ?? null,
          createdBy: actor.userId,
        })
        .returning();
      for (const u of attendees) await tx.insert(eventAttendees).values({ eventId: ev.id, userId: u });
      return ev;
    });

    const name = await this.people.displayName(actor.userId);
    for (const u of attendees) {
      await this.notifications.notify({
        userId: u,
        category: 'family',
        template: kind === 'visit' ? 'visit_scheduled' : 'event_invite',
        title: kind === 'visit' ? `${name} scheduled a visit: ${dto.title}` : `${name} invited you: ${dto.title}`,
        data: { type: 'calendar_event', id: e.id },
      });
    }
    if (dto.reminderMinutesBefore !== undefined) {
      const fireAt = new Date(startsAt.getTime() - dto.reminderMinutesBefore * 60_000);
      if (fireAt.getTime() > Date.now()) await this.reminders.create(actor.userId, { title: dto.title, fireAt, eventId: e.id });
    }
    return this.detail(actor, e.id);
  }

  async detail(actor: Actor, id: string) {
    const e = await this.load(id);
    if (!(await this.canView(actor, e))) throw notFound('Event');
    const attendees = await this.db
      .select({ userId: eventAttendees.userId, displayName: userProfiles.displayName, status: eventAttendees.status })
      .from(eventAttendees)
      .innerJoin(userProfiles, eq(userProfiles.userId, eventAttendees.userId))
      .where(eq(eventAttendees.eventId, id));
    return { ...e, attendees, canEdit: await this.canEdit(actor, e) };
  }

  /** Events in a window, with recurring events expanded into occurrences. */
  async list(actor: Actor, q: { from: string; to: string; householdId?: string; ownerUserId?: string }) {
    const from = new Date(q.from);
    const to = new Date(q.to);
    if (!(to > from)) throw badRequest('`to` must be after `from`', 'invalid_range');
    if (to.getTime() - from.getTime() > 400 * 86_400_000) throw badRequest('Window too large (max ~13 months)', 'range_too_large');
    const hh = await this.policy.householdIdsOf(actor.userId);
    if (q.householdId && !hh.includes(q.householdId)) throw notFound('Household');
    const sharedOwners = await this.policy.grantorsOf(actor.userId, 'calendar.view');
    if (q.ownerUserId && q.ownerUserId !== actor.userId && !sharedOwners.includes(q.ownerUserId)) throw notFound('Calendar');
    const attending = this.db.select({ id: eventAttendees.eventId }).from(eventAttendees).where(eq(eventAttendees.userId, actor.userId));

    const scope = q.householdId
      ? and(eq(calendarEvents.householdId, q.householdId), ne(calendarEvents.visibility, 'private'))
      : q.ownerUserId && q.ownerUserId !== actor.userId
        ? and(eq(calendarEvents.ownerUserId, q.ownerUserId), eq(calendarEvents.visibility, 'shared'))
        : or(
            eq(calendarEvents.ownerUserId, actor.userId),
            eq(calendarEvents.visitForUserId, actor.userId),
            hh.length ? and(inArray(calendarEvents.householdId, hh), ne(calendarEvents.visibility, 'private')) : undefined,
            sharedOwners.length ? and(inArray(calendarEvents.ownerUserId, sharedOwners), eq(calendarEvents.visibility, 'shared')) : undefined,
            inArray(calendarEvents.id, attending),
          );

    const rows = await this.db
      .select()
      .from(calendarEvents)
      .where(
        and(
          isNull(calendarEvents.cancelledAt),
          scope,
          lte(calendarEvents.startsAt, to),
          or(isNotNull(calendarEvents.recurrenceRule), gte(calendarEvents.startsAt, new Date(from.getTime() - 86_400_000))),
        ),
      )
      .orderBy(asc(calendarEvents.startsAt))
      .limit(1000);

    const out: (Event & { occurrenceStart: Date; occurrenceEnd: Date | null })[] = [];
    for (const e of rows) {
      const dur = e.endsAt ? e.endsAt.getTime() - e.startsAt.getTime() : null;
      const starts = e.recurrenceRule ? occurrencesBetween(e.recurrenceRule, e.startsAt, from, to) : [e.startsAt];
      for (const s of starts) {
        const end = dur !== null ? new Date(s.getTime() + dur) : null;
        if (s <= to && (end ?? s) >= from) out.push({ ...e, occurrenceStart: s, occurrenceEnd: end });
      }
    }
    out.sort((a, b) => a.occurrenceStart.getTime() - b.occurrenceStart.getTime());
    return { from, to, items: out.slice(0, 2000) };
  }

  async update(actor: Actor, id: string, dto: Partial<CreateEventInput>) {
    const e = await this.load(id);
    if (!(await this.canEdit(actor, e))) throw notFound('Event');
    const startsAt = dto.startsAt ? new Date(dto.startsAt) : e.startsAt;
    const endsAt = dto.endsAt === undefined ? e.endsAt : dto.endsAt ? new Date(dto.endsAt) : null;
    if (endsAt && endsAt < startsAt) throw badRequest('End must be after start', 'invalid_range');
    let rule = dto.recurrenceRule === undefined ? e.recurrenceRule : dto.recurrenceRule || null;
    if (rule) {
      parseRule(rule, startsAt);
      rule = normalizeRule(rule);
    }
    if (dto.visibility === 'household' && !e.householdId) throw badRequest("Use visibility 'household' only with a household", 'invalid_visibility');
    const [u] = await this.db
      .update(calendarEvents)
      .set({
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.kind ? { kind: dto.kind } : {}),
        ...(dto.allDay !== undefined ? { allDay: dto.allDay } : {}),
        ...(dto.locationText !== undefined ? { locationText: dto.locationText } : {}),
        ...(dto.visibility ? { visibility: dto.visibility } : {}),
        startsAt,
        endsAt,
        recurrenceRule: rule,
      })
      .where(eq(calendarEvents.id, id))
      .returning();
    if (dto.startsAt) {
      const attendees = await this.db.select({ u: eventAttendees.userId }).from(eventAttendees).where(eq(eventAttendees.eventId, id));
      for (const a of attendees) {
        await this.notifications.notify({ userId: a.u, category: 'family', template: 'event_changed', title: `Time changed: ${u.title}`, data: { type: 'calendar_event', id } });
      }
    }
    return u;
  }

  async cancel(actor: Actor, id: string) {
    const e = await this.load(id);
    if (!(await this.canEdit(actor, e))) throw notFound('Event');
    await this.db.update(calendarEvents).set({ cancelledAt: new Date() }).where(eq(calendarEvents.id, id));
    await this.reminders.cancelForEvent(id);
    const attendees = await this.db.select({ u: eventAttendees.userId }).from(eventAttendees).where(eq(eventAttendees.eventId, id));
    for (const a of attendees) {
      await this.notifications.notify({ userId: a.u, category: 'family', template: 'event_cancelled', title: `Cancelled: ${e.title}`, data: { type: 'calendar_event', id } });
    }
    return { id, cancelled: true };
  }

  async remove(actor: Actor, id: string) {
    const e = await this.load(id);
    if (!(await this.canEdit(actor, e))) throw notFound('Event');
    await this.reminders.cancelForEvent(id);
    await this.db.delete(calendarEvents).where(eq(calendarEvents.id, id));
  }

  async respond(actor: Actor, id: string, status: 'accepted' | 'declined' | 'tentative') {
    const res = await this.db
      .update(eventAttendees)
      .set({ status, respondedAt: new Date() })
      .where(and(eq(eventAttendees.eventId, id), eq(eventAttendees.userId, actor.userId)))
      .returning();
    if (!res.length) throw notFound('Invitation');
    const e = await this.load(id);
    const name = await this.people.displayName(actor.userId);
    await this.notifications.notify({ userId: e.ownerUserId, category: 'family', template: 'event_response', title: `${name} ${status} "${e.title}"`, data: { type: 'calendar_event', id } });
    return res[0];
  }

  async addAttendee(actor: Actor, id: string, userId: string) {
    const e = await this.load(id);
    if (!(await this.canEdit(actor, e))) throw notFound('Event');
    if (!(await this.canInvolve(actor, userId))) throw notFound('Person');
    await this.db.insert(eventAttendees).values({ eventId: id, userId }).onConflictDoNothing();
    const name = await this.people.displayName(actor.userId);
    await this.notifications.notify({ userId, category: 'family', template: 'event_invite', title: `${name} invited you: ${e.title}`, data: { type: 'calendar_event', id } });
    return this.detail(actor, id);
  }

  async removeAttendee(actor: Actor, id: string, userId: string) {
    const e = await this.load(id);
    if (userId !== actor.userId && !(await this.canEdit(actor, e))) throw notFound('Event');
    const res = await this.db.delete(eventAttendees).where(and(eq(eventAttendees.eventId, id), eq(eventAttendees.userId, userId))).returning();
    if (!res.length) throw notFound('Attendee');
  }
}
