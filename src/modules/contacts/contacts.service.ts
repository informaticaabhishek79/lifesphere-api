import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { SmsAdapter } from '../../adapters/messaging';
import { AuditService } from '../../common/audit.service';
import { Actor } from '../../common/auth-context';
import { CryptoService } from '../../common/crypto.service';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../common/errors';
import { ALL_SCOPES, GrantScope, PolicyService } from '../../common/policy.service';
import { addDays, addMinutes } from '../../common/time';
import { Env, ENV } from '../../config/env';
import { Database, DB } from '../../db/db';
import { accessGrants, checkInEscalationContacts, checkInSchedules, contactInvitations, trustedContacts, userProfiles, users } from '../../db/schema';
import { InviteHelper } from '../households/households.service';
import { NotificationsService } from '../notifications/notifications.service';

export const SCOPE_LABELS: Record<GrantScope, string> = {
  'tasks.view': 'see tasks you mark as shared',
  'tasks.assign': 'suggest tasks for you',
  'calendar.view': 'see calendar events you mark as shared',
  'checkins.view': 'see whether you checked in',
  'checkins.alerts': 'get alerts when you miss a check-in',
  'help.alerts': 'get alerts when you press Get help',
  'help.location': 'see your location when you press Get help (24 hours)',
};

@Injectable()
export class ContactsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    private readonly invites: InviteHelper,
    private readonly notifications: NotificationsService,
    private readonly sms: SmsAdapter,
  ) {}

  private validateScopes(scopes: string[] | undefined): GrantScope[] {
    const out = [...new Set(scopes ?? [])];
    for (const s of out) if (!ALL_SCOPES.includes(s as GrantScope)) throw badRequest(`Unknown scope ${s}`, 'invalid_scope');
    return out as GrantScope[];
  }

  // ------------------------------------------------------------------ invitations
  async invite(actor: Actor, dto: { phone?: string; email?: string; userId?: string; label?: string; message?: string; proposedScopes?: string[]; requestedScopes?: string[] }) {
    const scopes = this.validateScopes(dto.proposedScopes);
    const requested = this.validateScopes(dto.requestedScopes);
    const resolved = await this.invites.resolve(dto, actor.userId);
    if (resolved.userId === actor.userId) throw badRequest('You cannot add yourself', 'self_contact');
    if (resolved.userId && (await this.policy.isTrustedContact(actor.userId, resolved.userId))) throw conflict('Already a trusted contact', 'already_contact');
    if (resolved.userId && (await this.policy.isBlockedEitherWay(actor.userId, resolved.userId))) throw notFound('User');
    const [{ n }] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(contactInvitations)
      .where(and(eq(contactInvitations.inviterUserId, actor.userId), gt(contactInvitations.createdAt, addDays(new Date(), -1))));
    if (n >= 20) throw new AppError(429, 'invite_rate_limited', 'You have sent too many invitations today.');

    const token = this.crypto.randomToken(24);
    const [inv] = await this.db
      .insert(contactInvitations)
      .values({
        inviterUserId: actor.userId,
        inviteeUserId: resolved.userId,
        inviteeContactHash: resolved.contactHash,
        proposedScopes: scopes,
        requestedScopes: requested,
        label: dto.label,
        message: dto.message,
        tokenHash: this.crypto.hmac(token, 'invite-token'),
        expiresAt: addDays(new Date(), 14),
      })
      .returning();
    const name = await this.invites.displayName(actor.userId);
    const link = this.invites.link('contact', token);
    if (resolved.userId) {
      await this.notifications.notify({
        userId: resolved.userId,
        category: 'family',
        template: 'contact_invite',
        title: `${name} wants to add you as a trusted contact`,
        body: dto.message,
        data: { type: 'contact_invitation', id: inv.id },
        channels: ['push'],
      });
    } else {
      await this.invites.sendExternal(resolved.phone, resolved.email, name, 'be a trusted contact', link);
    }
    await this.audit.record(actor, { action: 'contact.invited', targetType: 'contact_invitation', targetId: inv.id, subjectUserId: actor.userId, metadata: { scopes: scopes.join(',') } });
    return { id: inv.id, status: inv.status, proposedScopes: scopes, requestedScopes: requested, expiresAt: inv.expiresAt, inviteLink: link };
  }

  async sentInvitations(actor: Actor) {
    return this.db
      .select({ id: contactInvitations.id, status: contactInvitations.status, inviteeUserId: contactInvitations.inviteeUserId, label: contactInvitations.label, proposedScopes: contactInvitations.proposedScopes, requestedScopes: contactInvitations.requestedScopes, expiresAt: contactInvitations.expiresAt, createdAt: contactInvitations.createdAt })
      .from(contactInvitations)
      .where(eq(contactInvitations.inviterUserId, actor.userId))
      .orderBy(desc(contactInvitations.createdAt))
      .limit(100);
  }

  async incomingInvitations(actor: Actor) {
    return this.db
      .select({ id: contactInvitations.id, inviterUserId: contactInvitations.inviterUserId, inviterName: userProfiles.displayName, message: contactInvitations.message, proposedScopes: contactInvitations.proposedScopes, requestedScopes: contactInvitations.requestedScopes, expiresAt: contactInvitations.expiresAt })
      .from(contactInvitations)
      .innerJoin(userProfiles, eq(userProfiles.userId, contactInvitations.inviterUserId))
      .where(and(eq(contactInvitations.inviteeUserId, actor.userId), eq(contactInvitations.status, 'pending'), gt(contactInvitations.expiresAt, new Date())));
  }

  /** Preview an invitation from its link before accepting (shows who invited and what they offer to share). */
  async previewByToken(actor: Actor, token: string) {
    const [inv] = await this.db.select().from(contactInvitations).where(eq(contactInvitations.tokenHash, this.crypto.hmac(token, 'invite-token')));
    if (!inv || inv.status !== 'pending' || inv.expiresAt < new Date()) throw notFound('Invitation');
    if (!(await this.invites.matches(actor.userId, inv.inviteeUserId, inv.inviteeContactHash))) throw forbidden('This invitation was sent to a different phone number or email.', 'invitation_not_for_you');
    return { id: inv.id, inviterName: await this.invites.displayName(inv.inviterUserId), message: inv.message, proposedScopes: inv.proposedScopes.map((s) => ({ scope: s, meaning: SCOPE_LABELS[s as GrantScope] })), requestedScopes: inv.requestedScopes.map((s) => ({ scope: s, meaning: SCOPE_LABELS[s as GrantScope] })) };
  }

  async cancelInvitation(actor: Actor, id: string) {
    const res = await this.db
      .update(contactInvitations)
      .set({ status: 'cancelled', respondedAt: new Date() })
      .where(and(eq(contactInvitations.id, id), eq(contactInvitations.inviterUserId, actor.userId), eq(contactInvitations.status, 'pending')))
      .returning({ id: contactInvitations.id });
    if (!res.length) throw notFound('Invitation');
  }

  async respond(actor: Actor, by: { id?: string; token?: string }, accept: boolean, shareBack: string[] = []) {
    const where = by.id ? eq(contactInvitations.id, by.id) : eq(contactInvitations.tokenHash, this.crypto.hmac(by.token!, 'invite-token'));
    const [inv] = await this.db.select().from(contactInvitations).where(where);
    if (!inv || inv.status !== 'pending' || inv.expiresAt < new Date()) throw notFound('Invitation');
    if (by.id && inv.inviteeUserId !== actor.userId) throw notFound('Invitation');
    if (inv.inviterUserId === actor.userId) throw badRequest('You cannot accept your own invitation', 'self_contact');
    if (!(await this.invites.matches(actor.userId, inv.inviteeUserId, inv.inviteeContactHash))) {
      throw forbidden('This invitation was sent to a different phone number or email.', 'invitation_not_for_you');
    }
    const back = accept ? this.validateScopes(shareBack) : [];
    for (const s of back) if (!inv.requestedScopes.includes(s)) throw badRequest('You can only share what was asked for', 'scope_not_requested');
    // Sharing back is a new grant from the invitee, so it needs the same recent sign-in as Sharing (checked before anything changes).
    if (back.length && Date.now() - Math.max(actor.sessionCreatedAt.getTime(), actor.reauthAt?.getTime() ?? 0) > 10 * 60_000) {
      throw new AppError(403, 'reauth_required', 'Please confirm it is you before making this change.');
    }
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx.update(contactInvitations).set({ status: accept ? 'accepted' : 'declined', respondedAt: now, inviteeUserId: actor.userId }).where(eq(contactInvitations.id, inv.id));
      if (!accept) return;
      await tx.insert(trustedContacts).values({ userId: inv.inviterUserId, contactUserId: actor.userId, label: inv.label }).onConflictDoNothing();
      await tx.insert(trustedContacts).values({ userId: actor.userId, contactUserId: inv.inviterUserId }).onConflictDoNothing();
      const effectiveAt = new Date(Math.max(now.getTime(), addMinutes(inv.createdAt, this.env.GRANT_COOLOFF_MINUTES).getTime()));
      for (const scope of inv.proposedScopes as GrantScope[]) {
        await tx
          .insert(accessGrants)
          .values({ grantorId: inv.inviterUserId, granteeId: actor.userId, scope, status: effectiveAt <= now ? 'active' : 'pending_cooloff', effectiveAt, createdBy: inv.inviterUserId })
          .onConflictDoNothing();
      }
    });
    const name = await this.invites.displayName(actor.userId);
    await this.notifications.notify({
      userId: inv.inviterUserId,
      category: 'family',
      template: accept ? 'contact_accepted' : 'contact_declined',
      title: accept ? `${name} is now your trusted contact` : `${name} declined your invitation`,
      data: { type: 'contact', id: actor.userId },
    });
    await this.audit.record(actor, { action: accept ? 'contact.accepted' : 'contact.declined', targetType: 'contact_invitation', targetId: inv.id, subjectUserId: inv.inviterUserId });
    // Same path as Sharing: cooling-off, in-app and SMS notice to the person sharing, audit.
    if (back.length) await this.createGrants(actor, inv.inviterUserId, back);
    // Whoever offered "alert them if I miss a check-in" meant it for their check-ins that already alert someone.
    if (accept && inv.proposedScopes.includes('checkins.alerts')) await this.addAlertContact(inv.inviterUserId, actor.userId);
    if (back.includes('checkins.alerts')) await this.addAlertContact(actor.userId, inv.inviterUserId);
    return { status: accept ? 'accepted' : 'declined', contactUserId: accept ? inv.inviterUserId : undefined, sharedBack: back };
  }

  /** Adds a contact to the person's check-ins and medicines that are set to alert contacts. */
  private async addAlertContact(userId: string, contactUserId: string) {
    const schedules = await this.db.select({ id: checkInSchedules.id }).from(checkInSchedules).where(and(eq(checkInSchedules.userId, userId), eq(checkInSchedules.escalate, true)));
    for (const s of schedules) {
      const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(checkInEscalationContacts).where(eq(checkInEscalationContacts.scheduleId, s.id));
      if (n >= 5) continue;
      await this.db.insert(checkInEscalationContacts).values({ scheduleId: s.id, contactUserId, position: n }).onConflictDoNothing();
    }
  }

  // ------------------------------------------------------------------ contacts
  async list(actor: Actor) {
    const rows = await this.db
      .select({ contactUserId: trustedContacts.contactUserId, label: trustedContacts.label, since: trustedContacts.createdAt, displayName: userProfiles.displayName, avatarAttachmentId: userProfiles.avatarAttachmentId })
      .from(trustedContacts)
      .innerJoin(userProfiles, eq(userProfiles.userId, trustedContacts.contactUserId))
      .where(and(eq(trustedContacts.userId, actor.userId), isNull(trustedContacts.removedAt)));
    const ids = rows.map((r) => r.contactUserId);
    const grants = ids.length
      ? await this.db
          .select()
          .from(accessGrants)
          .where(
            and(
              inArray(accessGrants.status, ['pending_cooloff', 'active']),
              or(and(eq(accessGrants.grantorId, actor.userId), inArray(accessGrants.granteeId, ids)), and(eq(accessGrants.granteeId, actor.userId), inArray(accessGrants.grantorId, ids))),
            ),
          )
      : [];
    return rows.map((r) => ({
      ...r,
      iShare: grants.filter((g) => g.grantorId === actor.userId && g.granteeId === r.contactUserId).map((g) => ({ id: g.id, scope: g.scope, status: g.status, effectiveAt: g.effectiveAt, expiresAt: g.expiresAt })),
      sharedWithMe: grants.filter((g) => g.granteeId === actor.userId && g.grantorId === r.contactUserId).map((g) => ({ id: g.id, scope: g.scope, status: g.status, effectiveAt: g.effectiveAt })),
    }));
  }

  async setLabel(actor: Actor, contactUserId: string, label: string | null) {
    const res = await this.db
      .update(trustedContacts)
      .set({ label })
      .where(and(eq(trustedContacts.userId, actor.userId), eq(trustedContacts.contactUserId, contactUserId), isNull(trustedContacts.removedAt)))
      .returning();
    if (!res.length) throw notFound('Contact');
    return res[0];
  }

  /** Removes the relationship both ways and revokes every grant between the two people. */
  async remove(actor: Actor, contactUserId: string) {
    if (!(await this.policy.isTrustedContact(actor.userId, contactUserId))) throw notFound('Contact');
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await tx
        .update(trustedContacts)
        .set({ removedAt: now })
        .where(
          and(
            isNull(trustedContacts.removedAt),
            or(and(eq(trustedContacts.userId, actor.userId), eq(trustedContacts.contactUserId, contactUserId)), and(eq(trustedContacts.userId, contactUserId), eq(trustedContacts.contactUserId, actor.userId))),
          ),
        );
      await tx
        .update(accessGrants)
        .set({ status: 'revoked', revokedAt: now, revokedBy: actor.userId })
        .where(
          and(
            inArray(accessGrants.status, ['pending_cooloff', 'active']),
            or(and(eq(accessGrants.grantorId, actor.userId), eq(accessGrants.granteeId, contactUserId)), and(eq(accessGrants.grantorId, contactUserId), eq(accessGrants.granteeId, actor.userId))),
          ),
        );
      await tx.execute(
        sql`delete from check_in_escalation_contacts e using check_in_schedules s where e.schedule_id = s.id and ((s.user_id = ${actor.userId} and e.contact_user_id = ${contactUserId}) or (s.user_id = ${contactUserId} and e.contact_user_id = ${actor.userId}))`,
      );
    });
    await this.audit.record(actor, { action: 'contact.removed', targetType: 'user', targetId: contactUserId, subjectUserId: actor.userId });
  }

  // ------------------------------------------------------------------ grants
  async grants(actor: Actor, direction: 'given' | 'received' | 'all' = 'all', includeInactive = false) {
    const dir =
      direction === 'given' ? eq(accessGrants.grantorId, actor.userId) : direction === 'received' ? eq(accessGrants.granteeId, actor.userId) : or(eq(accessGrants.grantorId, actor.userId), eq(accessGrants.granteeId, actor.userId));
    const rows = await this.db
      .select()
      .from(accessGrants)
      .where(and(dir, includeInactive ? undefined : inArray(accessGrants.status, ['pending_cooloff', 'active'])))
      .orderBy(desc(accessGrants.createdAt))
      .limit(500);
    const ids = [...new Set(rows.flatMap((r) => [r.grantorId, r.granteeId]))];
    const names = ids.length ? await this.db.select({ id: userProfiles.userId, n: userProfiles.displayName }).from(userProfiles).where(inArray(userProfiles.userId, ids)) : [];
    const nm = new Map(names.map((x) => [x.id, x.n]));
    const now = new Date();
    return rows.map((g) => ({
      id: g.id,
      direction: g.grantorId === actor.userId ? 'given' : 'received',
      grantorId: g.grantorId,
      grantorName: nm.get(g.grantorId) ?? null,
      granteeId: g.granteeId,
      granteeName: nm.get(g.granteeId) ?? null,
      scope: g.scope,
      meaning: SCOPE_LABELS[g.scope as GrantScope],
      status: g.status === 'pending_cooloff' && g.effectiveAt <= now ? 'active' : g.status,
      effectiveAt: g.effectiveAt,
      expiresAt: g.expiresAt,
      createdAt: g.createdAt,
      revokedAt: g.revokedAt,
    }));
  }

  /**
   * Give a trusted contact access to specific scopes. Requires recent re-authentication (enforced at the route),
   * takes effect after the cooling-off window, and the grantor is told by SMS as well as in-app.
   */
  async createGrants(actor: Actor, granteeId: string, scopes: string[], expiresAt?: string) {
    const valid = this.validateScopes(scopes);
    if (!valid.length) throw badRequest('Choose at least one thing to share', 'scopes_required');
    if (granteeId === actor.userId) throw badRequest('You cannot grant access to yourself', 'self_grant');
    if (!(await this.policy.isTrustedContact(actor.userId, granteeId))) throw notFound('Contact');
    const exp = expiresAt ? new Date(expiresAt) : null;
    if (exp && exp <= new Date()) throw badRequest('Expiry must be in the future', 'invalid_expiry');
    const now = new Date();
    const effectiveAt = addMinutes(now, this.env.GRANT_COOLOFF_MINUTES);
    const created: (typeof accessGrants.$inferSelect)[] = [];
    for (const scope of valid) {
      const [g] = await this.db
        .insert(accessGrants)
        .values({ grantorId: actor.userId, granteeId, scope, status: this.env.GRANT_COOLOFF_MINUTES === 0 ? 'active' : 'pending_cooloff', effectiveAt: this.env.GRANT_COOLOFF_MINUTES === 0 ? now : effectiveAt, expiresAt: exp, createdBy: actor.userId })
        .onConflictDoNothing()
        .returning();
      if (g) created.push(g);
    }
    if (!created.length) throw conflict('These permissions are already shared', 'already_granted');
    const granteeName = await this.invites.displayName(granteeId);
    const what = created.map((g) => SCOPE_LABELS[g.scope as GrantScope]).join('; ');
    await this.notifications.notify({
      userId: actor.userId,
      category: 'security',
      template: 'grant_created',
      title: `You are sharing with ${granteeName}`,
      body: `${granteeName} will be able to ${what}${this.env.GRANT_COOLOFF_MINUTES ? ` in ${this.env.GRANT_COOLOFF_MINUTES} minute${this.env.GRANT_COOLOFF_MINUTES === 1 ? '' : 's'}` : ''}. You can undo this any time.`,
      data: { type: 'grants', id: actor.userId },
      critical: true,
    });
    // Out-of-band notice so a person whose unlocked phone was used by someone else still finds out.
    const [u] = await this.db.select({ phone: users.phoneE164, pv: users.phoneVerifiedAt }).from(users).where(eq(users.id, actor.userId));
    if (u?.phone && u.pv) await this.sms.send(u.phone, 'alert', { var1: `LifeSphere: new sharing with ${granteeName}. Not you? Open the app and remove it.`.slice(0, 120) });
    for (const g of created) {
      await this.audit.record(actor, { action: 'grant.created', targetType: 'access_grant', targetId: g.id, subjectUserId: actor.userId, metadata: { scope: g.scope, grantee: granteeId } });
    }
    return this.grants(actor, 'given');
  }

  /** Grantor revokes, or grantee gives up, a grant. Immediate; no approval from the other side. */
  async revoke(actor: Actor, grantId: string) {
    const [g] = await this.db.select().from(accessGrants).where(eq(accessGrants.id, grantId));
    if (!g || (g.grantorId !== actor.userId && g.granteeId !== actor.userId)) throw notFound('Grant');
    if (!['pending_cooloff', 'active'].includes(g.status)) return { id: g.id, status: g.status };
    await this.db.update(accessGrants).set({ status: 'revoked', revokedAt: new Date(), revokedBy: actor.userId }).where(eq(accessGrants.id, grantId));
    if (g.scope === 'checkins.alerts') {
      await this.db.execute(
        sql`delete from check_in_escalation_contacts e using check_in_schedules s where e.schedule_id = s.id and s.user_id = ${g.grantorId} and e.contact_user_id = ${g.granteeId}`,
      );
    }
    const other = actor.userId === g.grantorId ? g.granteeId : g.grantorId;
    const name = await this.invites.displayName(actor.userId);
    await this.notifications.notify({
      userId: other,
      category: 'family',
      template: 'grant_revoked',
      title: actor.userId === g.grantorId ? `${name} stopped sharing: ${SCOPE_LABELS[g.scope as GrantScope]}` : `${name} no longer receives: ${SCOPE_LABELS[g.scope as GrantScope]}`,
      data: { type: 'grants', id: g.id },
    });
    await this.audit.record(actor, { action: 'grant.revoked', targetType: 'access_grant', targetId: g.id, subjectUserId: g.grantorId, metadata: { scope: g.scope } });
    return { id: g.id, status: 'revoked' };
  }

  /** Plain-language "who can see what" summary for the grantor. */
  async whoCanSee(actor: Actor) {
    const given = await this.grants(actor, 'given');
    const byPerson = new Map<string, { granteeId: string; name: string | null; access: string[] }>();
    for (const g of given) {
      const e = byPerson.get(g.granteeId) ?? { granteeId: g.granteeId, name: g.granteeName, access: [] };
      e.access.push(`${g.meaning}${g.status === 'pending_cooloff' ? ' (starts soon)' : ''}`);
      byPerson.set(g.granteeId, e);
    }
    return { people: [...byPerson.values()], total: byPerson.size };
  }

  // ------------------------------------------------------------------ worker
  /** Activates grants whose cooling-off ended and expires grants past their expiry. */
  async activateDueGrants() {
    const now = new Date();
    const activated = await this.db
      .update(accessGrants)
      .set({ status: 'active' })
      .where(and(eq(accessGrants.status, 'pending_cooloff'), lte(accessGrants.effectiveAt, now)))
      .returning();
    for (const g of activated) {
      const name = await this.invites.displayName(g.grantorId);
      await this.notifications.notify({
        userId: g.granteeId,
        category: 'family',
        template: 'grant_active',
        title: `${name} is now sharing with you`,
        body: `You can ${SCOPE_LABELS[g.scope as GrantScope]}.`,
        data: { type: 'grants', id: g.id },
      });
      await this.audit.system({ action: 'grant.activated', targetType: 'access_grant', targetId: g.id, subjectUserId: g.grantorId, metadata: { scope: g.scope } });
    }
    await this.db
      .update(accessGrants)
      .set({ status: 'expired' })
      .where(and(inArray(accessGrants.status, ['active', 'pending_cooloff']), lte(accessGrants.expiresAt, now)));
    return activated.length;
  }

  /** Monthly reminder to every grantor of who can see their data. */
  async monthlySharingSummary() {
    const grantors = await this.db.selectDistinct({ id: accessGrants.grantorId }).from(accessGrants).where(eq(accessGrants.status, 'active'));
    for (const { id } of grantors) {
      const people = await this.db.selectDistinct({ g: accessGrants.granteeId }).from(accessGrants).where(and(eq(accessGrants.grantorId, id), eq(accessGrants.status, 'active')));
      await this.notifications.notify({
        userId: id,
        category: 'security',
        template: 'monthly_sharing_summary',
        title: `${people.length} ${people.length === 1 ? 'person can' : 'people can'} see some of your information`,
        body: 'Review who you share with in Family → Sharing. You can stop sharing any time.',
        data: { type: 'grants', id },
      });
    }
    return grantors.length;
  }
}

void checkInEscalationContacts;
void checkInSchedules;
