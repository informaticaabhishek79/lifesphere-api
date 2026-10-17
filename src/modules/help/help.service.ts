import { countryInfo } from '../../common/countries';
import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, lt } from 'drizzle-orm';
import { AuditService } from '../../common/audit.service';
import { Actor } from '../../common/auth-context';
import { AppError, notFound, unprocessable } from '../../common/errors';
import { PolicyService } from '../../common/policy.service';
import { addDays } from '../../common/time';
import { Database, DB } from '../../db/db';
import {
  alertDeliveries,
  consentRecords,
  emergencyContactPreferences,
  helpRequestRecipients,
  helpRequests,
  serviceCategories,
  serviceRequests,
  userProfiles,
  users,
} from '../../db/schema';
import { InviteHelper } from '../households/households.service';
import { NotificationsService } from '../notifications/notifications.service';

export interface HelpInput {
  kind: 'notify_contacts' | 'call' | 'service_request';
  message?: string;
  shareLocation?: boolean;
  lat?: number;
  lng?: number;
  serviceCategoryId?: string;
}

/**
 * One-tap help. Every response states exactly what happened (who is being notified, whether location was
 * shared, which number to call). Nothing is presented as delivered until a provider confirms it.
 * LifeSphere is not an emergency service; the emergency number is always offered.
 */
@Injectable()
export class HelpService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly people: InviteHelper,
  ) {}

  async preferences(actor: Actor) {
    const [p] = await this.db.select().from(emergencyContactPreferences).where(eq(emergencyContactPreferences.userId, actor.userId));
    const prefs = p ?? { userId: actor.userId, emergencyNumber: await this.localEmergencyNumber(actor.userId), primaryCallContactId: null, notifyContacts: true, shareLocationByDefault: false, defaultMessage: null };
    const alertRecipients = await this.policy.granteesOf(actor.userId, 'help.alerts');
    const names = alertRecipients.length ? await this.db.select({ id: userProfiles.userId, n: userProfiles.displayName }).from(userProfiles).where(inArray(userProfiles.userId, alertRecipients)) : [];
    return {
      ...prefs,
      callTargets: await this.callTargets(actor.userId, prefs.emergencyNumber, prefs.primaryCallContactId),
      alertRecipients: names.map((n) => ({ userId: n.id, displayName: n.n })),
      disclaimer: `LifeSphere is not an emergency service. In an emergency, call ${prefs.emergencyNumber}.`,
    };
  }

  /** The main emergency number for the user's country (112 when unknown). */
  private async localEmergencyNumber(userId: string) {
    const [p] = await this.db.select({ country: userProfiles.country }).from(userProfiles).where(eq(userProfiles.userId, userId));
    return countryInfo(p?.country).emergency;
  }

  private async callTargets(userId: string, emergencyNumber: string, primaryContactId: string | null) {
    const targets: { label: string; number: string; kind: 'emergency' | 'contact' }[] = [{ label: `Emergency (${emergencyNumber})`, number: emergencyNumber, kind: 'emergency' }];
    if (primaryContactId && (await this.policy.isTrustedContact(userId, primaryContactId))) {
      const [c] = await this.db
        .select({ phone: users.phoneE164, verified: users.phoneVerifiedAt, name: userProfiles.displayName })
        .from(users)
        .innerJoin(userProfiles, eq(userProfiles.userId, users.id))
        .where(eq(users.id, primaryContactId));
      if (c?.phone && c.verified) targets.push({ label: c.name, number: c.phone, kind: 'contact' });
    }
    return targets;
  }

  async updatePreferences(actor: Actor, dto: { emergencyNumber?: string; primaryCallContactId?: string | null; notifyContacts?: boolean; shareLocationByDefault?: boolean; defaultMessage?: string | null }) {
    if (dto.primaryCallContactId && !(await this.policy.isTrustedContact(actor.userId, dto.primaryCallContactId))) throw notFound('Contact');
    if (dto.shareLocationByDefault && !(await this.hasLocationConsent(actor.userId))) {
      await this.db.insert(consentRecords).values({ userId: actor.userId, purpose: 'location_help', policyVersion: 'help-location-v1' }).onConflictDoNothing();
      await this.audit.record(actor, { action: 'consent.granted', targetType: 'consent', subjectUserId: actor.userId, metadata: { purpose: 'location_help' } });
    }
    const patch = Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined));
    await this.db
      .insert(emergencyContactPreferences)
      .values({ userId: actor.userId, emergencyNumber: await this.localEmergencyNumber(actor.userId), ...patch })
      .onConflictDoUpdate({ target: emergencyContactPreferences.userId, set: patch });
    return this.preferences(actor);
  }

  private async hasLocationConsent(userId: string) {
    const [c] = await this.db
      .select({ id: consentRecords.id })
      .from(consentRecords)
      .where(and(eq(consentRecords.userId, userId), eq(consentRecords.purpose, 'location_help'), isNull(consentRecords.withdrawnAt)))
      .limit(1);
    return !!c;
  }

  async request(actor: Actor, dto: HelpInput) {
    const prefs = await this.preferences(actor);
    const shareLocation = (dto.shareLocation ?? prefs.shareLocationByDefault) && dto.lat !== undefined && dto.lng !== undefined;
    if (shareLocation && !(await this.hasLocationConsent(actor.userId))) {
      throw new AppError(409, 'consent_required', 'Allow location sharing for help requests first (Help settings), or send without location.');
    }
    const actions: { type: string; detail: string; status: string }[] = [];
    let serviceRequestId: string | null = null;

    if (dto.kind === 'service_request') {
      if (!dto.serviceCategoryId) throw unprocessable('Choose a type of help', 'category_required');
      const [cat] = await this.db.select().from(serviceCategories).where(and(eq(serviceCategories.id, dto.serviceCategoryId), eq(serviceCategories.active, true)));
      if (!cat) throw notFound('Service category');
      const [sr] = await this.db
        .insert(serviceRequests)
        .values({ requesterId: actor.userId, categoryId: cat.id, title: `Help request: ${cat.name}`, description: dto.message, status: 'requested' })
        .returning({ id: serviceRequests.id });
      serviceRequestId = sr.id;
      actions.push({ type: 'service_request', detail: `A ${cat.name} request was created. A provider must accept it before anyone comes.`, status: 'requested' });
    }

    const [hr] = await this.db
      .insert(helpRequests)
      .values({
        userId: actor.userId,
        kind: dto.kind,
        message: dto.message ?? prefs.defaultMessage ?? undefined,
        locationLat: shareLocation ? dto.lat!.toFixed(4) : null,
        locationLng: shareLocation ? dto.lng!.toFixed(4) : null,
        locationExpiresAt: shareLocation ? addDays(new Date(), 1) : null,
        serviceRequestId,
      })
      .returning();

    const recipients = prefs.notifyContacts || dto.kind === 'notify_contacts' ? prefs.alertRecipients : [];
    if (recipients.length) {
      const name = await this.people.displayName(actor.userId);
      for (const r of recipients) {
        await this.db.insert(helpRequestRecipients).values({ helpRequestId: hr.id, recipientUserId: r.userId }).onConflictDoNothing();
        const res = await this.notifications.notify({
          userId: r.userId,
          category: 'help',
          template: 'help_request',
          title: `${name} asked for help`,
          body: hr.message ?? 'Please contact them as soon as you can.',
          data: { type: 'help_request', id: hr.id },
          channels: ['push', 'sms'],
          critical: true,
          smsText: `LifeSphere: ${name} pressed Get help. Please contact them now.`.slice(0, 120),
          related: { type: 'help_request', id: hr.id },
        });
        for (const j of res.jobs.length ? res.jobs : [{ id: null as string | null }]) {
          await this.db.insert(alertDeliveries).values({ alertType: 'help_request', alertId: hr.id, recipientUserId: r.userId, notificationJobId: j.id });
        }
      }
      actions.push({ type: 'notify_contacts', detail: `Notifying ${recipients.length} trusted ${recipients.length === 1 ? 'contact' : 'contacts'}. Check below for delivery.`, status: 'queued' });
    } else if (dto.kind === 'notify_contacts') {
      actions.push({ type: 'notify_contacts', detail: 'No contacts can receive help alerts yet. Add one in Sharing, or call instead.', status: 'not_sent' });
    }
    if (dto.kind === 'call') actions.push({ type: 'call', detail: 'Use one of the numbers below to call now. LifeSphere does not place the call for you.', status: 'ready' });
    actions.push({ type: 'location', detail: shareLocation ? 'Your approximate location is visible for 24 hours to contacts allowed to see it.' : 'Your location was not shared.', status: shareLocation ? 'shared' : 'not_shared' });

    await this.audit.record(actor, { action: 'help.requested', targetType: 'help_request', targetId: hr.id, subjectUserId: actor.userId, metadata: { kind: dto.kind, recipients: recipients.length, location: shareLocation } });
    return { helpRequest: await this.detail(actor, hr.id), actions, callTargets: prefs.callTargets, disclaimer: prefs.disclaimer };
  }

  private async canSee(actor: Actor, hr: typeof helpRequests.$inferSelect) {
    if (hr.userId === actor.userId) return 'owner' as const;
    const [r] = await this.db
      .select()
      .from(helpRequestRecipients)
      .where(and(eq(helpRequestRecipients.helpRequestId, hr.id), eq(helpRequestRecipients.recipientUserId, actor.userId)));
    return r ? ('recipient' as const) : null;
  }

  async detail(actor: Actor, id: string) {
    const [hr] = await this.db.select().from(helpRequests).where(eq(helpRequests.id, id));
    if (!hr) throw notFound('Help request');
    const role = await this.canSee(actor, hr);
    if (!role) throw notFound('Help request');
    const locationVisible =
      !!hr.locationLat && (!hr.locationExpiresAt || hr.locationExpiresAt > new Date()) && (role === 'owner' || (await this.policy.hasGrant(actor.userId, hr.userId, 'help.location')));
    const recipients = await this.db
      .select({ userId: helpRequestRecipients.recipientUserId, displayName: userProfiles.displayName, acknowledgedAt: helpRequestRecipients.acknowledgedAt })
      .from(helpRequestRecipients)
      .innerJoin(userProfiles, eq(userProfiles.userId, helpRequestRecipients.recipientUserId))
      .where(eq(helpRequestRecipients.helpRequestId, id));
    const jobs = await this.notifications.jobsFor('help_request', [id]);
    const [requester] = await this.db.select({ n: userProfiles.displayName }).from(userProfiles).where(eq(userProfiles.userId, hr.userId));
    return {
      id: hr.id,
      requesterId: hr.userId,
      requesterName: requester?.n ?? null,
      kind: hr.kind,
      message: hr.message,
      status: hr.status,
      createdAt: hr.createdAt,
      resolvedAt: hr.resolvedAt,
      serviceRequestId: role === 'owner' ? hr.serviceRequestId : undefined,
      location: locationVisible ? { lat: hr.locationLat, lng: hr.locationLng, visibleUntil: hr.locationExpiresAt } : null,
      recipients: recipients.map((r) => ({
        ...r,
        deliveries: role === 'owner' ? jobs.filter((j) => j.userId === r.userId).map((j) => ({ channel: j.channel, status: j.status, sentAt: j.sentAt, deliveredAt: j.deliveredAt })) : undefined,
      })),
    };
  }

  async mine(actor: Actor) {
    return this.db.select().from(helpRequests).where(eq(helpRequests.userId, actor.userId)).orderBy(desc(helpRequests.createdAt)).limit(50);
  }

  async incoming(actor: Actor) {
    const rows = await this.db
      .select({ id: helpRequests.id, userId: helpRequests.userId, displayName: userProfiles.displayName, kind: helpRequests.kind, message: helpRequests.message, status: helpRequests.status, createdAt: helpRequests.createdAt, acknowledgedAt: helpRequestRecipients.acknowledgedAt })
      .from(helpRequestRecipients)
      .innerJoin(helpRequests, eq(helpRequests.id, helpRequestRecipients.helpRequestId))
      .innerJoin(userProfiles, eq(userProfiles.userId, helpRequests.userId))
      .where(and(eq(helpRequestRecipients.recipientUserId, actor.userId), inArray(helpRequests.status, ['open', 'acknowledged'])))
      .orderBy(desc(helpRequests.createdAt));
    return rows;
  }

  async acknowledge(actor: Actor, id: string) {
    const [hr] = await this.db.select().from(helpRequests).where(eq(helpRequests.id, id));
    if (!hr || (await this.canSee(actor, hr)) !== 'recipient') throw notFound('Help request');
    await this.db
      .update(helpRequestRecipients)
      .set({ acknowledgedAt: new Date() })
      .where(and(eq(helpRequestRecipients.helpRequestId, id), eq(helpRequestRecipients.recipientUserId, actor.userId)));
    if (hr.status === 'open') await this.db.update(helpRequests).set({ status: 'acknowledged' }).where(eq(helpRequests.id, id));
    const name = await this.people.displayName(actor.userId);
    await this.notifications.notify({ userId: hr.userId, category: 'help', template: 'help_acknowledged', title: `${name} saw your request and is responding`, data: { type: 'help_request', id }, channels: ['push', 'sms'], critical: true, smsText: `LifeSphere: ${name} saw your help request`.slice(0, 120) });
    await this.audit.record(actor, { action: 'help.acknowledged', targetType: 'help_request', targetId: id, subjectUserId: hr.userId });
    return this.detail(actor, id);
  }

  async resolve(actor: Actor, id: string, cancel = false) {
    const [hr] = await this.db.select().from(helpRequests).where(eq(helpRequests.id, id));
    const role = hr ? await this.canSee(actor, hr) : null;
    if (!hr || !role || (cancel && role !== 'owner')) throw notFound('Help request');
    if (!['open', 'acknowledged'].includes(hr.status)) return this.detail(actor, id);
    await this.db
      .update(helpRequests)
      .set({ status: cancel ? 'cancelled' : 'resolved', resolvedAt: new Date(), locationLat: null, locationLng: null, locationExpiresAt: null })
      .where(eq(helpRequests.id, id));
    const others = await this.db.select({ u: helpRequestRecipients.recipientUserId }).from(helpRequestRecipients).where(eq(helpRequestRecipients.helpRequestId, id));
    const name = await this.people.displayName(actor.userId);
    for (const u of [hr.userId, ...others.map((o) => o.u)].filter((x) => x !== actor.userId)) {
      await this.notifications.notify({ userId: u, category: 'help', template: cancel ? 'help_cancelled' : 'help_resolved', title: cancel ? `${name} cancelled the help request` : `${name} marked the help request as resolved`, data: { type: 'help_request', id } });
    }
    await this.audit.record(actor, { action: cancel ? 'help.cancelled' : 'help.resolved', targetType: 'help_request', targetId: id, subjectUserId: hr.userId });
    return this.detail(actor, id);
  }

  /** Worker: erase help locations after 24 hours. */
  async purgeLocations() {
    const res = await this.db
      .update(helpRequests)
      .set({ locationLat: null, locationLng: null, locationExpiresAt: null })
      .where(lt(helpRequests.locationExpiresAt, new Date()))
      .returning({ id: helpRequests.id });
    return res.length;
  }
}
