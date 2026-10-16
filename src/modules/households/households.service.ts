import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { EmailAdapter, SmsAdapter } from '../../adapters/messaging';
import { AuditService } from '../../common/audit.service';
import { Actor } from '../../common/auth-context';
import { CryptoService, normalizeEmail, normalizePhone } from '../../common/crypto.service';
import { AppError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../common/errors';
import { PolicyService } from '../../common/policy.service';
import { addDays } from '../../common/time';
import { Env, ENV } from '../../config/env';
import { Database, DB } from '../../db/db';
import { familyAnnouncements, householdInvitations, householdMembers, households, userProfiles, users } from '../../db/schema';
import { NotificationsService } from '../notifications/notifications.service';

export interface InviteTarget {
  phone?: string;
  email?: string;
  userId?: string;
}

/** Shared helpers for invitations bound to a specific contact (prevents forwarded links being used by others). */
@Injectable()
export class InviteHelper {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly crypto: CryptoService,
    private readonly sms: SmsAdapter,
    private readonly email: EmailAdapter,
  ) {}

  contactHash(kind: 'phone' | 'email', value: string) {
    return this.crypto.hmac(`${kind}:${value}`, 'invite');
  }

  /** Resolve a target into (existing user id?, contact hash, normalised contact). */
  async resolve(target: InviteTarget) {
    const given = [target.phone, target.email, target.userId].filter(Boolean).length;
    if (given !== 1) throw badRequest('Provide exactly one of phone, email or userId', 'invite_target_required');
    if (target.userId) {
      const [u] = await this.db.select({ id: users.id, status: users.status }).from(users).where(eq(users.id, target.userId));
      if (!u || u.status !== 'active') throw notFound('User');
      return { userId: u.id, contactHash: null as string | null, phone: null as string | null, email: null as string | null };
    }
    if (target.phone) {
      const phone = normalizePhone(target.phone);
      if (!phone) throw badRequest('Enter a valid mobile number', 'invalid_destination');
      const [u] = await this.db.select({ id: users.id }).from(users).where(and(eq(users.phoneE164, phone), eq(users.status, 'active')));
      return { userId: u?.id ?? null, contactHash: this.contactHash('phone', phone), phone, email: null };
    }
    const email = normalizeEmail(target.email!);
    if (!email) throw badRequest('Enter a valid email address', 'invalid_destination');
    const [u] = await this.db.select({ id: users.id }).from(users).where(and(eq(users.email, email), eq(users.status, 'active')));
    return { userId: u?.id ?? null, contactHash: this.contactHash('email', email), phone: null, email };
  }

  /** Does the accepting user own the contact the invitation was bound to? */
  async matches(userId: string, inviteeUserId: string | null, contactHash: string | null) {
    if (inviteeUserId) return inviteeUserId === userId;
    if (!contactHash) return true;
    const [u] = await this.db
      .select({ phone: users.phoneE164, email: users.email, pv: users.phoneVerifiedAt, ev: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.id, userId));
    if (!u) return false;
    return (
      (!!u.phone && !!u.pv && this.contactHash('phone', u.phone) === contactHash) ||
      (!!u.email && !!u.ev && this.contactHash('email', u.email) === contactHash)
    );
  }

  link(kind: 'household' | 'contact' | 'group', token: string) {
    return `${this.env.APP_BASE_URL}/invite/${kind}#token=${token}`;
  }

  /** Send the invite link to a person who has no account yet. */
  async sendExternal(phone: string | null, email: string | null, inviterName: string, what: string, link: string) {
    if (phone) await this.sms.send(phone, 'alert', { var1: `${inviterName} invited you to ${what} on LifeSphere: ${link}`.slice(0, 160) });
    if (email) await this.email.send(email, `${inviterName} invited you to LifeSphere`, `${inviterName} invited you to ${what} on LifeSphere.\n\nOpen this link to accept: ${link}\n\nIf you don't know this person, ignore this message.`);
  }

  async displayName(userId: string) {
    const [p] = await this.db.select({ n: userProfiles.displayName }).from(userProfiles).where(eq(userProfiles.userId, userId));
    return p?.n ?? 'Someone';
  }
}

@Injectable()
export class HouseholdsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    private readonly invites: InviteHelper,
    private readonly notifications: NotificationsService,
  ) {}

  async create(actor: Actor, name: string) {
    return this.db.transaction(async (tx) => {
      const [h] = await tx.insert(households).values({ name, createdBy: actor.userId }).returning();
      await tx.insert(householdMembers).values({ householdId: h.id, userId: actor.userId, role: 'admin' });
      await this.audit.record(actor, { action: 'household.created', targetType: 'household', targetId: h.id }, tx);
      return { ...h, role: 'admin' as const };
    });
  }

  async listMine(actor: Actor) {
    return this.db
      .select({
        id: households.id,
        name: households.name,
        role: householdMembers.role,
        createdAt: households.createdAt,
        memberCount: sql<number>`(select count(*)::int from household_members m where m.household_id = ${households.id})`,
      })
      .from(householdMembers)
      .innerJoin(households, eq(households.id, householdMembers.householdId))
      .where(and(eq(householdMembers.userId, actor.userId), isNull(households.deletedAt)));
  }

  async get(actor: Actor, id: string) {
    const role = await this.policy.requireHouseholdMember(actor.userId, id);
    const [h] = await this.db.select().from(households).where(and(eq(households.id, id), isNull(households.deletedAt)));
    if (!h) throw notFound('Household');
    const members = await this.db
      .select({ userId: householdMembers.userId, role: householdMembers.role, joinedAt: householdMembers.joinedAt, displayName: userProfiles.displayName, avatarAttachmentId: userProfiles.avatarAttachmentId })
      .from(householdMembers)
      .innerJoin(userProfiles, eq(userProfiles.userId, householdMembers.userId))
      .where(eq(householdMembers.householdId, id));
    return { id: h.id, name: h.name, createdAt: h.createdAt, myRole: role, members };
  }

  async rename(actor: Actor, id: string, name: string) {
    await this.policy.requireHouseholdAdmin(actor.userId, id);
    const [h] = await this.db.update(households).set({ name }).where(eq(households.id, id)).returning();
    return h;
  }

  async remove(actor: Actor, id: string) {
    await this.policy.requireHouseholdAdmin(actor.userId, id);
    await this.db.delete(households).where(eq(households.id, id));
    await this.audit.record(actor, { action: 'household.deleted', targetType: 'household', targetId: id });
  }

  async invite(actor: Actor, id: string, target: { phone?: string; email?: string; userId?: string; role?: 'admin' | 'member' }) {
    await this.policy.requireHouseholdAdmin(actor.userId, id);
    const resolved = await this.invites.resolve(target);
    if (resolved.userId === actor.userId) throw badRequest('You are already a member', 'already_member');
    if (resolved.userId && (await this.policy.householdRole(resolved.userId, id))) throw conflict('This person is already a member', 'already_member');
    const [{ n }] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(householdInvitations)
      .where(and(eq(householdInvitations.invitedBy, actor.userId), gt(householdInvitations.createdAt, addDays(new Date(), -1))));
    if (n >= 20) throw new AppError(429, 'invite_rate_limited', 'You have sent too many invitations today.');
    const token = this.crypto.randomToken(24);
    const [inv] = await this.db
      .insert(householdInvitations)
      .values({
        householdId: id,
        invitedBy: actor.userId,
        inviteeUserId: resolved.userId,
        inviteeContactHash: resolved.contactHash,
        role: target.role ?? 'member',
        tokenHash: this.crypto.hmac(token, 'invite-token'),
        expiresAt: addDays(new Date(), 7),
      })
      .returning();
    const inviterName = await this.invites.displayName(actor.userId);
    const [h] = await this.db.select({ name: households.name }).from(households).where(eq(households.id, id));
    const link = this.invites.link('household', token);
    if (resolved.userId) {
      await this.notifications.notify({
        userId: resolved.userId,
        category: 'household',
        template: 'household_invite',
        title: `${inviterName} invited you to join ${h.name}`,
        data: { type: 'household_invitation', id: inv.id },
        channels: ['push'],
      });
    } else {
      await this.invites.sendExternal(resolved.phone, resolved.email, inviterName, `join the household "${h.name}"`, link);
    }
    await this.audit.record(actor, { action: 'household.invited', targetType: 'household', targetId: id, metadata: { existingUser: !!resolved.userId } });
    return { id: inv.id, status: inv.status, expiresAt: inv.expiresAt, inviteLink: link };
  }

  async listInvitations(actor: Actor, id: string) {
    await this.policy.requireHouseholdAdmin(actor.userId, id);
    return this.db
      .select({ id: householdInvitations.id, status: householdInvitations.status, role: householdInvitations.role, inviteeUserId: householdInvitations.inviteeUserId, expiresAt: householdInvitations.expiresAt, createdAt: householdInvitations.createdAt })
      .from(householdInvitations)
      .where(eq(householdInvitations.householdId, id))
      .orderBy(desc(householdInvitations.createdAt));
  }

  async cancelInvitation(actor: Actor, id: string, invId: string) {
    await this.policy.requireHouseholdAdmin(actor.userId, id);
    const res = await this.db
      .update(householdInvitations)
      .set({ status: 'cancelled', respondedAt: new Date() })
      .where(and(eq(householdInvitations.id, invId), eq(householdInvitations.householdId, id), eq(householdInvitations.status, 'pending')))
      .returning({ id: householdInvitations.id });
    if (!res.length) throw notFound('Invitation');
  }

  async incoming(actor: Actor) {
    return this.db
      .select({ id: householdInvitations.id, householdId: householdInvitations.householdId, householdName: households.name, invitedBy: householdInvitations.invitedBy, inviterName: userProfiles.displayName, role: householdInvitations.role, expiresAt: householdInvitations.expiresAt })
      .from(householdInvitations)
      .innerJoin(households, eq(households.id, householdInvitations.householdId))
      .innerJoin(userProfiles, eq(userProfiles.userId, householdInvitations.invitedBy))
      .where(and(eq(householdInvitations.inviteeUserId, actor.userId), eq(householdInvitations.status, 'pending'), gt(householdInvitations.expiresAt, new Date())));
  }

  /** Accept by id (invitee is a known user) or by token (link). The token is bound to the invited contact. */
  async respond(actor: Actor, by: { id?: string; token?: string }, accept: boolean) {
    const where = by.id ? eq(householdInvitations.id, by.id) : eq(householdInvitations.tokenHash, this.crypto.hmac(by.token!, 'invite-token'));
    const [inv] = await this.db.select().from(householdInvitations).where(where);
    if (!inv || inv.status !== 'pending' || inv.expiresAt < new Date()) throw notFound('Invitation');
    if (!(await this.invites.matches(actor.userId, inv.inviteeUserId, inv.inviteeContactHash))) {
      throw forbidden('This invitation was sent to a different phone number or email.', 'invitation_not_for_you');
    }
    if (by.id && inv.inviteeUserId !== actor.userId) throw notFound('Invitation');
    await this.db.transaction(async (tx) => {
      await tx
        .update(householdInvitations)
        .set({ status: accept ? 'accepted' : 'declined', respondedAt: new Date(), inviteeUserId: actor.userId })
        .where(eq(householdInvitations.id, inv.id));
      if (accept) {
        await tx.insert(householdMembers).values({ householdId: inv.householdId, userId: actor.userId, role: inv.role }).onConflictDoNothing();
      }
    });
    if (accept) {
      const name = await this.invites.displayName(actor.userId);
      await this.notifications.notify({
        userId: inv.invitedBy,
        category: 'household',
        template: 'household_joined',
        title: `${name} joined your household`,
        data: { type: 'household', id: inv.householdId },
      });
      await this.audit.record(actor, { action: 'household.joined', targetType: 'household', targetId: inv.householdId });
    }
    return { status: accept ? 'accepted' : 'declined', householdId: accept ? inv.householdId : undefined };
  }

  async setRole(actor: Actor, id: string, userId: string, role: 'admin' | 'member') {
    await this.policy.requireHouseholdAdmin(actor.userId, id);
    if (role === 'member') await this.ensureAnotherAdmin(id, userId);
    const res = await this.db
      .update(householdMembers)
      .set({ role })
      .where(and(eq(householdMembers.householdId, id), eq(householdMembers.userId, userId)))
      .returning();
    if (!res.length) throw notFound('Member');
    await this.audit.record(actor, { action: 'household.role_changed', targetType: 'household', targetId: id, subjectUserId: userId, metadata: { role } });
    return res[0];
  }

  private async ensureAnotherAdmin(householdId: string, leavingUserId: string) {
    const admins = await this.db
      .select({ userId: householdMembers.userId })
      .from(householdMembers)
      .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.role, 'admin')));
    if (admins.length === 1 && admins[0].userId === leavingUserId) {
      throw unprocessable('Make someone else an admin first', 'last_admin');
    }
  }

  /** Admin removes a member, or a member leaves. The last member leaving deletes the household. */
  async removeMember(actor: Actor, id: string, userId: string) {
    const role = await this.policy.requireHouseholdMember(actor.userId, id);
    if (userId !== actor.userId && role !== 'admin') throw notFound('Household');
    const members = await this.db.select().from(householdMembers).where(eq(householdMembers.householdId, id));
    if (!members.some((m) => m.userId === userId)) throw notFound('Member');
    if (members.length === 1) {
      await this.db.delete(households).where(eq(households.id, id));
      return { householdDeleted: true };
    }
    await this.ensureAnotherAdmin(id, userId);
    await this.db.delete(householdMembers).where(and(eq(householdMembers.householdId, id), eq(householdMembers.userId, userId)));
    // Remove their pending assignments on this household's tasks.
    await this.db.execute(
      sql`delete from task_assignments ta using tasks t where ta.task_id = t.id and t.household_id = ${id} and ta.assignee_user_id = ${userId}`,
    );
    await this.audit.record(actor, { action: userId === actor.userId ? 'household.left' : 'household.member_removed', targetType: 'household', targetId: id, subjectUserId: userId });
    return { householdDeleted: false };
  }

  // ------------------------------------------------------------------ announcements
  async announcements(actor: Actor, id: string) {
    await this.policy.requireHouseholdMember(actor.userId, id);
    return this.db
      .select({ id: familyAnnouncements.id, body: familyAnnouncements.body, pinned: familyAnnouncements.pinned, authorId: familyAnnouncements.authorId, authorName: userProfiles.displayName, expiresAt: familyAnnouncements.expiresAt, createdAt: familyAnnouncements.createdAt })
      .from(familyAnnouncements)
      .leftJoin(userProfiles, eq(userProfiles.userId, familyAnnouncements.authorId))
      .where(eq(familyAnnouncements.householdId, id))
      .orderBy(desc(familyAnnouncements.pinned), desc(familyAnnouncements.createdAt))
      .limit(50);
  }

  async announce(actor: Actor, id: string, dto: { body: string; pinned?: boolean; expiresAt?: string }) {
    await this.policy.requireHouseholdMember(actor.userId, id);
    const [a] = await this.db
      .insert(familyAnnouncements)
      .values({ householdId: id, authorId: actor.userId, body: dto.body, pinned: !!dto.pinned, expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null })
      .returning();
    const members = await this.db.select({ userId: householdMembers.userId }).from(householdMembers).where(eq(householdMembers.householdId, id));
    const name = await this.invites.displayName(actor.userId);
    for (const m of members.filter((x) => x.userId !== actor.userId)) {
      await this.notifications.notify({
        userId: m.userId,
        category: 'family',
        template: 'family_announcement',
        title: `${name} posted a family announcement`,
        body: dto.body.slice(0, 140),
        data: { type: 'household', id },
      });
    }
    return a;
  }

  async updateAnnouncement(actor: Actor, id: string, aid: string, dto: { body?: string; pinned?: boolean }) {
    const role = await this.policy.requireHouseholdMember(actor.userId, id);
    const [a] = await this.db.select().from(familyAnnouncements).where(and(eq(familyAnnouncements.id, aid), eq(familyAnnouncements.householdId, id)));
    if (!a) throw notFound('Announcement');
    if (a.authorId !== actor.userId && role !== 'admin') throw notFound('Announcement');
    const [u] = await this.db
      .update(familyAnnouncements)
      .set({ ...(dto.body !== undefined ? { body: dto.body } : {}), ...(dto.pinned !== undefined ? { pinned: dto.pinned } : {}) })
      .where(eq(familyAnnouncements.id, aid))
      .returning();
    return u;
  }

  async deleteAnnouncement(actor: Actor, id: string, aid: string) {
    const role = await this.policy.requireHouseholdMember(actor.userId, id);
    const [a] = await this.db.select().from(familyAnnouncements).where(and(eq(familyAnnouncements.id, aid), eq(familyAnnouncements.householdId, id)));
    if (!a || (a.authorId !== actor.userId && role !== 'admin')) throw notFound('Announcement');
    await this.db.delete(familyAnnouncements).where(eq(familyAnnouncements.id, aid));
  }
}

