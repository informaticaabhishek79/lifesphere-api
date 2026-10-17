import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lt, lte, ne, notInArray, or, sql } from 'drizzle-orm';
import { AuditService } from '../../common/audit.service';
import { Actor } from '../../common/auth-context';
import { maskEmail, maskPhone } from '../../common/crypto.service';
import { badRequest, notFound } from '../../common/errors';
import { CursorQuery, keyset, lim, pageOf } from '../../common/pagination';
import { PolicyService } from '../../common/policy.service';
import { addDays, isValidTimeZone, localParts, zonedTimeToUtc } from '../../common/time';
import { countryInfo, isCountryCode } from '../../common/countries';
import { Database, DB } from '../../db/db';
import {
  accessGrants,
  attachments,
  auditEvents,
  calendarEvents,
  checkInEvents,
  communityGroups,
  consumerCases,
  eventAttendees,
  groupMemberships,
  localities,
  posts,
  reminders,
  serviceRequests,
  staffRoles,
  taskAssignments,
  tasks,
  userPreferences,
  userProfiles,
  users,
} from '../../db/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { AuthService } from '../auth/auth.service';
import { LocalityQuery, UpdatePreferencesDto, UpdateProfileDto } from './me.dto';

export const DEFAULT_ACCESSIBILITY = {
  textScale: 1,
  highContrast: false,
  reduceMotion: false,
  voiceNavigation: false,
  screenReaderHints: false,
  simpleConfirmations: true,
};

const DEFAULT_WIDGETS = [
  'today_tasks',
  'upcoming_reminders',
  'check_ins',
  'family_activity',
  'household',
  'service_requests',
  'community_updates',
  'consumer_cases',
  'quick_actions',
].map((key, order) => ({ key, enabled: true, order }));

@Injectable()
export class MeService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly policy: PolicyService,
    private readonly notifications: NotificationsService,
    private readonly auth: AuthService,
  ) {}

  async ensureRows(userId: string) {
    await this.db.insert(userPreferences).values({ userId }).onConflictDoNothing();
  }

  async me(actor: Actor) {
    await this.ensureRows(actor.userId);
    const [row] = await this.db
      .select({ user: users, profile: userProfiles, prefs: userPreferences, locality: localities })
      .from(users)
      .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
      .leftJoin(userPreferences, eq(userPreferences.userId, users.id))
      .leftJoin(localities, eq(localities.id, userProfiles.localityId))
      .where(eq(users.id, actor.userId))
      .limit(1);
    if (!row) throw notFound('Account');
    const { user, profile, prefs, locality } = row;
    return {
      id: user.id,
      status: user.status,
      phone: user.phoneE164,
      phoneMasked: user.phoneE164 ? maskPhone(user.phoneE164) : null,
      phoneVerified: !!user.phoneVerifiedAt,
      email: user.email,
      emailMasked: user.email ? maskEmail(user.email) : null,
      emailVerified: !!user.emailVerifiedAt,
      deletionRequestedAt: user.deletionRequestedAt,
      createdAt: user.createdAt,
      profile: profile
        ? {
            displayName: profile.displayName,
            avatarAttachmentId: profile.avatarAttachmentId,
            locale: profile.locale,
            timezone: profile.timezone,
            country: profile.country,
            /** Local defaults for the user's country (currency, emergency number…). */
            countryDefaults: countryInfo(profile.country),
            seniorMode: profile.seniorMode,
            discoverable: profile.discoverable,
            bio: profile.bio,
            locality: locality ? { id: locality.id, name: locality.name, city: locality.city, state: locality.state, country: locality.country } : null,
          }
        : null,
      preferences: prefs ? this.prefsOut(prefs) : null,
      staffRoles: actor.staffRoles,
      session: { id: actor.sessionId, mfaVerified: actor.mfaVerified },
      mfa: await this.auth.mfaStatus(actor.userId),
    };
  }

  private prefsOut(p: typeof userPreferences.$inferSelect) {
    return {
      theme: p.theme,
      accessibility: { ...DEFAULT_ACCESSIBILITY, ...p.accessibility },
      dashboardWidgets: p.dashboardWidgets.length ? p.dashboardWidgets : DEFAULT_WIDGETS,
      disabledFeatures: p.disabledFeatures,
      lockScreenDetail: p.lockScreenDetail,
      quietHoursStart: p.quietHoursStart?.slice(0, 5) ?? null,
      quietHoursEnd: p.quietHoursEnd?.slice(0, 5) ?? null,
      aiEnabled: p.aiEnabled,
      aiStoreHistory: p.aiStoreHistory,
    };
  }

  async updateProfile(actor: Actor, dto: UpdateProfileDto) {
    if (dto.timezone && !isValidTimeZone(dto.timezone)) throw badRequest('Unknown time zone', 'invalid_timezone');
    if (dto.country && !isCountryCode(dto.country)) throw badRequest('Unknown country', 'invalid_country');
    if (dto.localityId) {
      const [l] = await this.db.select({ id: localities.id }).from(localities).where(and(eq(localities.id, dto.localityId), eq(localities.active, true)));
      if (!l) throw notFound('Locality');
    }
    if (dto.avatarAttachmentId) {
      const [a] = await this.db
        .select({ id: attachments.id })
        .from(attachments)
        .where(and(eq(attachments.id, dto.avatarAttachmentId), eq(attachments.ownerUserId, actor.userId), eq(attachments.purpose, 'avatar'), eq(attachments.status, 'ready')));
      if (!a) throw notFound('Attachment');
    }
    const patch = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined));
    if (Object.keys(patch).length) {
      await this.db.update(userProfiles).set(patch).where(eq(userProfiles.userId, actor.userId));
    }
    if (dto.timezone) {
      // Keep check-in schedules in the user's zone unless they set one explicitly.
      await this.db.execute(sql`update check_in_schedules set timezone = ${dto.timezone} where user_id = ${actor.userId}`);
    }
    return this.me(actor);
  }

  async updatePreferences(actor: Actor, dto: UpdatePreferencesDto) {
    await this.ensureRows(actor.userId);
    const [current] = await this.db.select().from(userPreferences).where(eq(userPreferences.userId, actor.userId));
    const patch: Partial<typeof userPreferences.$inferInsert> = {};
    if (dto.theme) patch.theme = dto.theme;
    if (dto.accessibility) patch.accessibility = { ...DEFAULT_ACCESSIBILITY, ...current.accessibility, ...dto.accessibility };
    if (dto.dashboardWidgets) patch.dashboardWidgets = dto.dashboardWidgets;
    if (dto.disabledFeatures) patch.disabledFeatures = [...new Set(dto.disabledFeatures)];
    if (dto.lockScreenDetail) patch.lockScreenDetail = dto.lockScreenDetail;
    if (dto.quietHoursStart !== undefined) patch.quietHoursStart = dto.quietHoursStart;
    if (dto.quietHoursEnd !== undefined) patch.quietHoursEnd = dto.quietHoursEnd;
    if ((patch.quietHoursStart ?? current.quietHoursStart) && !(patch.quietHoursEnd ?? current.quietHoursEnd)) {
      throw badRequest('Set both quiet hours start and end', 'quiet_hours_incomplete');
    }
    if (dto.aiEnabled !== undefined) patch.aiEnabled = dto.aiEnabled;
    if (dto.aiStoreHistory !== undefined) patch.aiStoreHistory = dto.aiStoreHistory;
    const [p] = await this.db.update(userPreferences).set(patch).where(eq(userPreferences.userId, actor.userId)).returning();
    return this.prefsOut(p);
  }

  /** Aggregated home screen. Each section is omitted when the user disabled that feature or widget. */
  async dashboard(actor: Actor) {
    await this.ensureRows(actor.userId);
    const [prefs] = await this.db.select().from(userPreferences).where(eq(userPreferences.userId, actor.userId));
    const [profile] = await this.db.select().from(userProfiles).where(eq(userProfiles.userId, actor.userId));
    const tz = profile?.timezone ?? 'UTC';
    const widgets = (prefs.dashboardWidgets.length ? prefs.dashboardWidgets : DEFAULT_WIDGETS).filter((w) => w.enabled);
    const on = (k: string) => widgets.some((w) => w.key === k);
    const off = new Set(prefs.disabledFeatures);
    const now = new Date();
    const p = localParts(now, tz);
    const dayStart = zonedTimeToUtc(p.year, p.month, p.day, 0, 0, tz);
    const dayEnd = addDays(dayStart, 1);
    const householdIds = await this.policy.householdIdsOf(actor.userId);
    const out: Record<string, unknown> = { generatedAt: now.toISOString(), timezone: tz, seniorMode: profile?.seniorMode ?? false, widgets };

    if (on('today_tasks') && !off.has('lifeos')) {
      const assignedIds = this.db
        .select({ id: taskAssignments.taskId })
        .from(taskAssignments)
        .where(and(eq(taskAssignments.assigneeUserId, actor.userId), eq(taskAssignments.status, 'accepted')));
      const scope = or(
        and(eq(tasks.ownerUserId, actor.userId), isNull(tasks.householdId)),
        householdIds.length ? inArray(tasks.householdId, householdIds) : undefined,
        inArray(tasks.id, assignedIds),
      );
      const open = and(isNull(tasks.deletedAt), inArray(tasks.status, ['pending', 'in_progress']), scope);
      out.todayTasks = await this.db
        .select({ id: tasks.id, title: tasks.title, dueAt: tasks.dueAt, priority: tasks.priority, status: tasks.status, householdId: tasks.householdId })
        .from(tasks)
        .where(and(open, gte(tasks.dueAt, dayStart), lt(tasks.dueAt, dayEnd)))
        .orderBy(asc(tasks.dueAt))
        .limit(20);
      const [{ n }] = await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(tasks)
        .where(and(open, lt(tasks.dueAt, now)));
      out.overdueTaskCount = n;
    }

    if (on('upcoming_reminders') && !off.has('lifeos')) {
      out.upcomingReminders = await this.db
        .select({ id: reminders.id, title: reminders.title, fireAt: reminders.fireAt, taskId: reminders.taskId, eventId: reminders.eventId })
        .from(reminders)
        .where(and(eq(reminders.userId, actor.userId), eq(reminders.status, 'scheduled'), gte(reminders.fireAt, now)))
        .orderBy(asc(reminders.fireAt))
        .limit(5);
    }

    if (on('check_ins') && !off.has('familycare')) {
      out.myCheckIns = await this.db
        .select({ id: checkInEvents.id, dueAt: checkInEvents.dueAt, state: checkInEvents.state, scheduleId: checkInEvents.scheduleId })
        .from(checkInEvents)
        .where(and(eq(checkInEvents.userId, actor.userId), gte(checkInEvents.dueAt, dayStart), lt(checkInEvents.dueAt, dayEnd)))
        .orderBy(asc(checkInEvents.dueAt));
      const watched = await this.policy.grantorsOf(actor.userId, 'checkins.view');
      const alerting = await this.policy.grantorsOf(actor.userId, 'checkins.alerts');
      const people = [...new Set([...watched, ...alerting])];
      out.peopleICheckOn = people.length
        ? await this.db
            .select({
              userId: checkInEvents.userId,
              displayName: userProfiles.displayName,
              eventId: checkInEvents.id,
              dueAt: checkInEvents.dueAt,
              state: checkInEvents.state,
            })
            .from(checkInEvents)
            .innerJoin(userProfiles, eq(userProfiles.userId, checkInEvents.userId))
            .where(and(inArray(checkInEvents.userId, people), gte(checkInEvents.dueAt, dayStart), lt(checkInEvents.dueAt, dayEnd)))
            .orderBy(asc(checkInEvents.dueAt))
        : [];
    }

    if (on('family_activity') && !off.has('familycare')) {
      const sharedCalendarOwners = await this.policy.grantorsOf(actor.userId, 'calendar.view');
      const attending = this.db.select({ id: eventAttendees.eventId }).from(eventAttendees).where(eq(eventAttendees.userId, actor.userId));
      out.familyActivity = await this.db
        .select({
          id: calendarEvents.id,
          title: calendarEvents.title,
          kind: calendarEvents.kind,
          startsAt: calendarEvents.startsAt,
          ownerUserId: calendarEvents.ownerUserId,
          householdId: calendarEvents.householdId,
        })
        .from(calendarEvents)
        .where(
          and(
            isNull(calendarEvents.cancelledAt),
            gte(calendarEvents.startsAt, now),
            lte(calendarEvents.startsAt, addDays(now, 7)),
            or(
              eq(calendarEvents.ownerUserId, actor.userId),
              householdIds.length ? and(inArray(calendarEvents.householdId, householdIds), ne(calendarEvents.visibility, 'private')) : undefined,
              sharedCalendarOwners.length
                ? and(inArray(calendarEvents.ownerUserId, sharedCalendarOwners), eq(calendarEvents.visibility, 'shared'))
                : undefined,
              inArray(calendarEvents.id, attending),
            ),
          ),
        )
        .orderBy(asc(calendarEvents.startsAt))
        .limit(10);
      out.pendingGrantsToReview = (
        await this.db
          .select({ id: accessGrants.id })
          .from(accessGrants)
          .where(and(eq(accessGrants.grantorId, actor.userId), eq(accessGrants.status, 'pending_cooloff')))
      ).length;
      out.pendingTaskAssignments = await this.db
        .select({ id: taskAssignments.id, taskId: taskAssignments.taskId, title: tasks.title, assignedBy: taskAssignments.assignedBy })
        .from(taskAssignments)
        .innerJoin(tasks, eq(tasks.id, taskAssignments.taskId))
        .where(and(eq(taskAssignments.assigneeUserId, actor.userId), eq(taskAssignments.status, 'proposed')))
        .limit(10);
    }

    if (on('service_requests') && !off.has('services')) {
      out.pendingServiceRequests = await this.db
        .select({ id: serviceRequests.id, title: serviceRequests.title, status: serviceRequests.status, scheduledAt: serviceRequests.scheduledAt })
        .from(serviceRequests)
        .where(
          and(
            eq(serviceRequests.requesterId, actor.userId),
            notInArray(serviceRequests.status, ['completed', 'cancelled', 'declined']),
          ),
        )
        .orderBy(desc(serviceRequests.updatedAt))
        .limit(5);
    }

    if (on('community_updates') && !off.has('community')) {
      const myGroups = this.db
        .select({ id: groupMemberships.groupId })
        .from(groupMemberships)
        .where(and(eq(groupMemberships.userId, actor.userId), eq(groupMemberships.status, 'active')));
      const blocked = await this.policy.blockedIds(actor.userId);
      out.communityUpdates = await this.db
        .select({ id: posts.id, groupId: posts.groupId, groupName: communityGroups.name, kind: posts.kind, title: posts.title, createdAt: posts.createdAt })
        .from(posts)
        .innerJoin(communityGroups, eq(communityGroups.id, posts.groupId))
        .where(
          and(
            inArray(posts.groupId, myGroups),
            eq(posts.status, 'published'),
            ne(posts.authorId, actor.userId),
            blocked.length ? notInArray(posts.authorId, blocked) : undefined,
          ),
        )
        .orderBy(desc(posts.createdAt))
        .limit(5);
    }

    if (on('consumer_cases') && !off.has('consumer')) {
      out.recentConsumerCases = await this.db
        .select({ id: consumerCases.id, title: consumerCases.title, status: consumerCases.status, nextFollowUpOn: consumerCases.nextFollowUpOn })
        .from(consumerCases)
        .where(and(eq(consumerCases.ownerUserId, actor.userId), isNull(consumerCases.deletedAt), notInArray(consumerCases.status, ['closed'])))
        .orderBy(desc(consumerCases.updatedAt))
        .limit(3);
    }

    if (on('household') && !off.has('household')) out.householdIds = householdIds;
    if (on('quick_actions')) {
      out.quickActions = [
        !off.has('lifeos') && { key: 'add_task', label: 'Add a task' },
        !off.has('lifeos') && { key: 'add_reminder', label: 'Set a reminder' },
        !off.has('household') && { key: 'add_grocery', label: 'Add to grocery list' },
        !off.has('familycare') && { key: 'check_in', label: "I'm OK — check in" },
        !off.has('familycare') && { key: 'get_help', label: 'Get help' },
        !off.has('services') && { key: 'find_service', label: 'Find local help' },
        !off.has('consumer') && { key: 'new_case', label: 'Track a complaint' },
      ].filter(Boolean);
    }
    out.unreadNotifications = await this.notifications.unreadCount(actor.userId);
    return out;
  }

  /** The user's own audit trail: sign-ins, sharing changes, privacy requests. */
  async myAudit(actor: Actor, q: CursorQuery) {
    const limit = lim(q);
    const rows = await this.db
      .select({ id: auditEvents.id, action: auditEvents.action, actorType: auditEvents.actorType, targetType: auditEvents.targetType, createdAt: auditEvents.createdAt, metadata: auditEvents.metadata, byMe: sql<boolean>`${auditEvents.actorId} = ${actor.userId}` })
      .from(auditEvents)
      .where(and(eq(auditEvents.subjectUserId, actor.userId), keyset(auditEvents.createdAt, auditEvents.id, q.cursor)))
      .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
      .limit(limit + 1);
    return pageOf(rows, limit, (r) => [r.createdAt, r.id]);
  }

  async localities(q: LocalityQuery, actor?: Actor) {
    let country = q.country === 'all' ? null : q.country ?? null;
    if (!q.country && actor) {
      const [p] = await this.db.select({ c: userProfiles.country }).from(userProfiles).where(eq(userProfiles.userId, actor.userId));
      country = p?.c ?? null;
    }
    return this.db
      .select({ id: localities.id, name: localities.name, city: localities.city, state: localities.state, country: localities.country, pincodePrefix: localities.pincodePrefix })
      .from(localities)
      .where(
        and(
          eq(localities.active, true),
          country ? eq(localities.country, country) : undefined,
          q.search ? or(ilike(localities.name, `%${q.search.replace(/[%_]/g, '')}%`), ilike(localities.city, `%${q.search.replace(/[%_]/g, '')}%`)) : undefined,
          q.city ? ilike(localities.city, q.city.replace(/[%_]/g, '')) : undefined,
          q.pincodePrefix ? eq(localities.pincodePrefix, q.pincodePrefix) : undefined,
        ),
      )
      .orderBy(asc(localities.city), asc(localities.name))
      .limit(50);
  }

  /**
   * Minimal card for another user (name + avatar). Visible only when there is a relationship:
   * same household, trusted contact, a grant either way, a shared active group, or a discoverable profile.
   */
  async userCard(actor: Actor, userId: string) {
    const [p] = await this.db
      .select({ userId: userProfiles.userId, displayName: userProfiles.displayName, avatarAttachmentId: userProfiles.avatarAttachmentId, discoverable: userProfiles.discoverable, status: users.status })
      .from(userProfiles)
      .innerJoin(users, eq(users.id, userProfiles.userId))
      .where(eq(userProfiles.userId, userId))
      .limit(1);
    if (!p || p.status === 'deleted') throw notFound('User');
    if (userId === actor.userId) return p;
    if (await this.policy.isBlockedEitherWay(actor.userId, userId)) throw notFound('User');
    const related =
      p.discoverable ||
      (await this.policy.shareHousehold(actor.userId, userId)) ||
      (await this.policy.isTrustedContact(actor.userId, userId)) ||
      (await this.policy.isTrustedContact(userId, actor.userId)) ||
      (await this.sharesGroup(actor.userId, userId));
    if (!related) throw notFound('User');
    return { userId: p.userId, displayName: p.displayName, avatarAttachmentId: p.avatarAttachmentId };
  }

  private async sharesGroup(a: string, b: string) {
    const mine = this.db.select({ id: groupMemberships.groupId }).from(groupMemberships).where(and(eq(groupMemberships.userId, a), eq(groupMemberships.status, 'active')));
    const [row] = await this.db
      .select({ id: groupMemberships.groupId })
      .from(groupMemberships)
      .where(and(eq(groupMemberships.userId, b), eq(groupMemberships.status, 'active'), inArray(groupMemberships.groupId, mine)))
      .limit(1);
    return !!row;
  }

  async staffRolesOf(userId: string) {
    return this.db.select({ role: staffRoles.role }).from(staffRoles).where(and(eq(staffRoles.userId, userId), isNull(staffRoles.revokedAt)));
  }
}
