import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, isNull, ne, notInArray, or, sql } from 'drizzle-orm';
import { forCountry } from '../../common/countries';
import { AuditService } from '../../common/audit.service';
import { Actor } from '../../common/auth-context';
import { CryptoService } from '../../common/crypto.service';
import { escapeLike } from '../../common/dto';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../common/errors';
import { CursorQuery, keyset, lim, pageOf } from '../../common/pagination';
import { PolicyService } from '../../common/policy.service';
import { addDays } from '../../common/time';
import { Database, DB } from '../../db/db';
import {
  attachments,
  bookmarks,
  civicIssues,
  comments,
  communityGroups,
  groupInvitations,
  groupMemberships,
  localities,
  officialChannels,
  postAttachments,
  posts,
  reactions,
  userBlocks,
  userProfiles,
} from '../../db/schema';
import { AttachmentsService } from '../attachments/attachments.service';
import { InviteHelper } from '../households/households.service';
import { ModerationService, TargetType } from '../moderation/moderation.service';
import { NotificationsService } from '../notifications/notifications.service';

type PostKind = 'text' | 'announcement' | 'event' | 'recommendation' | 'help_request' | 'civic_info' | 'lost_found';

export interface GroupInput {
  name?: string;
  description?: string;
  visibility?: 'public' | 'private' | 'invite_only';
  category?: string;
  localityId?: string | null;
  postingPolicy?: 'all_members' | 'admins_only';
  rules?: string;
}

export interface PostInput {
  kind?: PostKind;
  title?: string;
  body?: string;
  eventStartsAt?: string;
  eventEndsAt?: string;
  eventLocationText?: string;
  attachmentIds?: string[];
}

function slugify(s: string) {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/[\s_]+/g, '-')
      .slice(0, 80) || 'group'
  );
}

/** Never let a post carry something that looks like a precise home address or a phone number list by default. */
function addressWarning(text: string): string | null {
  if (/\b(flat|house|h\.?\s?no|plot|door)\s*(no\.?|number|#)?\s*\d+/i.test(text)) return 'This looks like it contains a home address. Consider sharing an approximate location instead.';
  return null;
}

@Injectable()
export class CommunityService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly crypto: CryptoService,
    private readonly moderation: ModerationService,
    private readonly notifications: NotificationsService,
    private readonly attachmentsSvc: AttachmentsService,
    private readonly people: InviteHelper,
  ) {}

  // ------------------------------------------------------------------ groups
  async discover(actor: Actor, q: CursorQuery & { search?: string; localityId?: string; category?: string; mine?: boolean }) {
    const limit = lim(q);
    const myGroups = this.db.select({ id: groupMemberships.groupId }).from(groupMemberships).where(and(eq(groupMemberships.userId, actor.userId), eq(groupMemberships.status, 'active')));
    const rows = await this.db
      .select({
        id: communityGroups.id,
        name: communityGroups.name,
        slug: communityGroups.slug,
        description: communityGroups.description,
        visibility: communityGroups.visibility,
        category: communityGroups.category,
        localityId: communityGroups.localityId,
        localityName: localities.name,
        memberCount: communityGroups.memberCount,
        createdAt: communityGroups.createdAt,
      })
      .from(communityGroups)
      .leftJoin(localities, eq(localities.id, communityGroups.localityId))
      .where(
        and(
          eq(communityGroups.status, 'active'),
          q.mine ? inArray(communityGroups.id, myGroups) : or(ne(communityGroups.visibility, 'invite_only'), inArray(communityGroups.id, myGroups)),
          q.search ? ilike(communityGroups.name, `%${escapeLike(q.search)}%`) : undefined,
          q.localityId ? eq(communityGroups.localityId, q.localityId) : undefined,
          q.category ? eq(communityGroups.category, q.category) : undefined,
          keyset(communityGroups.createdAt, communityGroups.id, q.cursor),
        ),
      )
      .orderBy(desc(communityGroups.createdAt), desc(communityGroups.id))
      .limit(limit + 1);
    const page = pageOf(rows, limit, (r) => [r.createdAt, r.id]);
    const ids = page.items.map((g) => g.id);
    const mine = ids.length
      ? await this.db.select().from(groupMemberships).where(and(eq(groupMemberships.userId, actor.userId), inArray(groupMemberships.groupId, ids)))
      : [];
    return { ...page, items: page.items.map((g) => ({ ...g, membership: mine.find((m) => m.groupId === g.id) ?? null })) };
  }

  async createGroup(actor: Actor, dto: GroupInput & { name: string }) {
    await this.moderation.assertCanPost(actor.userId);
    const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(communityGroups).where(and(eq(communityGroups.createdBy, actor.userId), sql`${communityGroups.createdAt} > now() - interval '1 day'`));
    if (n >= 5) throw unprocessable('You can create up to 5 groups a day', 'group_limit');
    if (dto.localityId) {
      const [l] = await this.db.select({ id: localities.id }).from(localities).where(eq(localities.id, dto.localityId));
      if (!l) throw notFound('Locality');
    }
    const slug = `${slugify(dto.name)}-${this.crypto.randomToken(4).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5)}`;
    return this.db.transaction(async (tx) => {
      const [g] = await tx
        .insert(communityGroups)
        .values({ name: dto.name, slug, description: dto.description, visibility: dto.visibility ?? 'private', category: dto.category, localityId: dto.localityId ?? null, postingPolicy: dto.postingPolicy ?? 'all_members', rules: dto.rules, createdBy: actor.userId, memberCount: 1 })
        .returning();
      await tx.insert(groupMemberships).values({ groupId: g.id, userId: actor.userId, role: 'owner' });
      await this.audit.record(actor, { action: 'group.created', targetType: 'group', targetId: g.id }, tx);
      return g;
    });
  }

  private async group(id: string) {
    const [g] = await this.db.select().from(communityGroups).where(eq(communityGroups.id, id));
    if (!g || g.status === 'archived') throw notFound('Group');
    return g;
  }

  async getGroup(actor: Actor, id: string) {
    const g = await this.group(id);
    const m = await this.policy.groupMembership(actor.userId, id);
    if (g.visibility === 'invite_only' && m?.status !== 'active') throw notFound('Group');
    if (m?.status === 'banned') throw notFound('Group');
    return { ...g, membership: m, canRead: await this.policy.canReadGroup(actor.userId, id) };
  }

  private async requireGroupAdmin(actor: Actor, id: string, allowModerator = false) {
    const m = await this.policy.groupMembership(actor.userId, id);
    const roles = allowModerator ? ['owner', 'admin', 'moderator'] : ['owner', 'admin'];
    if (!m || m.status !== 'active' || !roles.includes(m.role)) throw notFound('Group');
    return m;
  }

  async updateGroup(actor: Actor, id: string, dto: GroupInput) {
    await this.requireGroupAdmin(actor, id);
    const [g] = await this.db.update(communityGroups).set(Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined))).where(eq(communityGroups.id, id)).returning();
    return g;
  }

  async archiveGroup(actor: Actor, id: string) {
    const m = await this.requireGroupAdmin(actor, id);
    if (m.role !== 'owner') throw forbidden('Only the group owner can close the group');
    await this.db.update(communityGroups).set({ status: 'archived' }).where(eq(communityGroups.id, id));
    await this.audit.record(actor, { action: 'group.archived', targetType: 'group', targetId: id });
  }

  private async recount(groupId: string) {
    await this.db.execute(sql`update community_groups set member_count = (select count(*) from group_memberships where group_id = ${groupId} and status = 'active') where id = ${groupId}`);
  }

  async join(actor: Actor, id: string) {
    const g = await this.group(id);
    if (g.status !== 'active') throw notFound('Group');
    const m = await this.policy.groupMembership(actor.userId, id);
    if (m?.status === 'banned') throw notFound('Group');
    if (m?.status === 'active') return m;
    if (g.visibility === 'invite_only') throw forbidden('This group is invitation only', 'invitation_required');
    const status = g.visibility === 'public' ? 'active' : 'pending';
    const [row] = await this.db
      .insert(groupMemberships)
      .values({ groupId: id, userId: actor.userId, status, role: 'member' })
      .onConflictDoUpdate({ target: [groupMemberships.groupId, groupMemberships.userId], set: { status, role: 'member' } })
      .returning();
    await this.recount(id);
    if (status === 'pending') {
      const admins = await this.db.select({ u: groupMemberships.userId }).from(groupMemberships).where(and(eq(groupMemberships.groupId, id), inArray(groupMemberships.role, ['owner', 'admin']), eq(groupMemberships.status, 'active')));
      for (const a of admins) await this.notifications.notify({ userId: a.u, category: 'community', template: 'group_join_request', title: `New request to join ${g.name}`, data: { type: 'group', id } });
    }
    return row;
  }

  async leave(actor: Actor, id: string) {
    const m = await this.policy.groupMembership(actor.userId, id);
    if (!m || m.status === 'banned') throw notFound('Group');
    if (m.role === 'owner') {
      const [other] = await this.db.select().from(groupMemberships).where(and(eq(groupMemberships.groupId, id), eq(groupMemberships.status, 'active'), ne(groupMemberships.userId, actor.userId), inArray(groupMemberships.role, ['admin']))).limit(1);
      if (!other) throw unprocessable('Make another member an admin before leaving, or close the group', 'last_owner');
      await this.db.update(groupMemberships).set({ role: 'owner' }).where(and(eq(groupMemberships.groupId, id), eq(groupMemberships.userId, other.userId)));
    }
    await this.db.delete(groupMemberships).where(and(eq(groupMemberships.groupId, id), eq(groupMemberships.userId, actor.userId)));
    await this.recount(id);
  }

  /** Members are visible to active members only, and only by display name. */
  async members(actor: Actor, id: string, status: 'active' | 'pending' = 'active') {
    const m = await this.policy.groupMembership(actor.userId, id);
    if (!m || m.status !== 'active') throw notFound('Group');
    if (status === 'pending') await this.requireGroupAdmin(actor, id, true);
    return this.db
      .select({ userId: groupMemberships.userId, displayName: userProfiles.displayName, avatarAttachmentId: userProfiles.avatarAttachmentId, role: groupMemberships.role, status: groupMemberships.status, joinedAt: groupMemberships.joinedAt })
      .from(groupMemberships)
      .innerJoin(userProfiles, eq(userProfiles.userId, groupMemberships.userId))
      .where(and(eq(groupMemberships.groupId, id), eq(groupMemberships.status, status)))
      .orderBy(asc(userProfiles.displayName))
      .limit(1000);
  }

  async setMember(actor: Actor, id: string, userId: string, dto: { role?: 'admin' | 'moderator' | 'member'; status?: 'active' | 'banned' }) {
    const me = await this.requireGroupAdmin(actor, id, dto.role === undefined);
    if (userId === actor.userId) throw badRequest('You cannot change your own membership here', 'self_change');
    const target = await this.policy.groupMembership(userId, id);
    if (!target) throw notFound('Member');
    if (target.role === 'owner') throw forbidden('The owner cannot be changed');
    if (dto.role && me.role !== 'owner' && dto.role === 'admin') throw forbidden('Only the owner can appoint admins');
    const [u] = await this.db
      .update(groupMemberships)
      .set({ ...(dto.role ? { role: dto.role } : {}), ...(dto.status ? { status: dto.status } : {}) })
      .where(and(eq(groupMemberships.groupId, id), eq(groupMemberships.userId, userId)))
      .returning();
    await this.recount(id);
    if (dto.status === 'active' && target.status === 'pending') {
      const g = await this.group(id);
      await this.notifications.notify({ userId, category: 'community', template: 'group_join_approved', title: `You joined ${g.name}`, data: { type: 'group', id } });
    }
    await this.audit.record(actor, { action: 'group.member_updated', targetType: 'group', targetId: id, subjectUserId: userId, metadata: { role: dto.role ?? null, status: dto.status ?? null } });
    return u;
  }

  async removeMember(actor: Actor, id: string, userId: string) {
    await this.requireGroupAdmin(actor, id, true);
    const target = await this.policy.groupMembership(userId, id);
    if (!target || target.role === 'owner') throw notFound('Member');
    await this.db.delete(groupMemberships).where(and(eq(groupMemberships.groupId, id), eq(groupMemberships.userId, userId)));
    await this.recount(id);
  }

  async inviteToGroup(actor: Actor, id: string, inviteeUserId: string) {
    const m = await this.policy.groupMembership(actor.userId, id);
    const g = await this.group(id);
    if (!m || m.status !== 'active') throw notFound('Group');
    if (g.visibility === 'invite_only' && !['owner', 'admin', 'moderator'].includes(m.role)) throw forbidden('Only group admins can invite to this group');
    if (await this.policy.isBlockedEitherWay(actor.userId, inviteeUserId)) throw notFound('User');
    const existing = await this.policy.groupMembership(inviteeUserId, id);
    if (existing?.status === 'active') throw conflict('Already a member', 'already_member');
    if (existing?.status === 'banned') throw notFound('User');
    const token = this.crypto.randomToken(24);
    const [inv] = await this.db
      .insert(groupInvitations)
      .values({ groupId: id, invitedBy: actor.userId, inviteeUserId, tokenHash: this.crypto.hmac(token, 'invite-token'), expiresAt: addDays(new Date(), 14) })
      .returning();
    const name = await this.people.displayName(actor.userId);
    await this.notifications.notify({ userId: inviteeUserId, category: 'community', template: 'group_invite', title: `${name} invited you to join ${g.name}`, data: { type: 'group_invitation', id: inv.id } });
    return { id: inv.id, expiresAt: inv.expiresAt };
  }

  async myGroupInvitations(actor: Actor) {
    return this.db
      .select({ id: groupInvitations.id, groupId: groupInvitations.groupId, groupName: communityGroups.name, invitedBy: groupInvitations.invitedBy, expiresAt: groupInvitations.expiresAt })
      .from(groupInvitations)
      .innerJoin(communityGroups, eq(communityGroups.id, groupInvitations.groupId))
      .where(and(eq(groupInvitations.inviteeUserId, actor.userId), eq(groupInvitations.status, 'pending'), sql`${groupInvitations.expiresAt} > now()`));
  }

  async respondGroupInvitation(actor: Actor, invitationId: string, accept: boolean) {
    const [inv] = await this.db.select().from(groupInvitations).where(and(eq(groupInvitations.id, invitationId), eq(groupInvitations.inviteeUserId, actor.userId)));
    if (!inv || inv.status !== 'pending' || inv.expiresAt < new Date()) throw notFound('Invitation');
    await this.db.update(groupInvitations).set({ status: accept ? 'accepted' : 'declined' }).where(eq(groupInvitations.id, invitationId));
    if (accept) {
      await this.db
        .insert(groupMemberships)
        .values({ groupId: inv.groupId, userId: actor.userId, role: 'member', status: 'active' })
        .onConflictDoUpdate({ target: [groupMemberships.groupId, groupMemberships.userId], set: { status: 'active' } });
      await this.recount(inv.groupId);
    }
    return { status: accept ? 'accepted' : 'declined', groupId: inv.groupId };
  }

  // ------------------------------------------------------------------ posts
  private async postVisible(actor: Actor, p: typeof posts.$inferSelect) {
    if (p.status === 'deleted') return false;
    // Removed: only the author sees it (with the reason). Hidden (pending review): author and group staff.
    if (p.status === 'removed' && p.authorId !== actor.userId) return false;
    if (p.status === 'hidden' && p.authorId !== actor.userId && !(await this.policy.isGroupStaff(actor.userId, p.groupId))) return false;
    if (await this.policy.isBlockedEitherWay(actor.userId, p.authorId)) return false;
    return this.policy.canReadGroup(actor.userId, p.groupId);
  }

  private async withAuthors<T extends { authorId: string; id: string }>(actor: Actor, rows: T[]) {
    const authorIds = [...new Set(rows.map((r) => r.authorId))];
    const names = authorIds.length ? await this.db.select({ id: userProfiles.userId, n: userProfiles.displayName, a: userProfiles.avatarAttachmentId }).from(userProfiles).where(inArray(userProfiles.userId, authorIds)) : [];
    const ids = rows.map((r) => r.id);
    const mineReacted = ids.length ? await this.db.select({ postId: reactions.postId, kind: reactions.kind }).from(reactions).where(and(eq(reactions.userId, actor.userId), inArray(reactions.postId, ids))) : [];
    const mineSaved = ids.length ? await this.db.select({ postId: bookmarks.postId }).from(bookmarks).where(and(eq(bookmarks.userId, actor.userId), inArray(bookmarks.postId, ids))) : [];
    const files = ids.length
      ? await this.db.select({ postId: postAttachments.postId, id: attachments.id, mimeType: attachments.mimeType }).from(postAttachments).innerJoin(attachments, eq(attachments.id, postAttachments.attachmentId)).where(inArray(postAttachments.postId, ids))
      : [];
    return rows.map((r) => ({
      ...r,
      author: { userId: r.authorId, displayName: names.find((n) => n.id === r.authorId)?.n ?? 'Member', avatarAttachmentId: names.find((n) => n.id === r.authorId)?.a ?? null },
      myReaction: mineReacted.find((x) => x.postId === r.id)?.kind ?? null,
      bookmarked: mineSaved.some((x) => x.postId === r.id),
      attachments: files.filter((f) => f.postId === r.id).map(({ postId: _p, ...f }) => f),
    }));
  }

  /** Home feed: posts from my groups plus public groups in my locality, newest first, excluding blocked people. */
  async feed(actor: Actor, q: CursorQuery & { localityId?: string; kind?: string }) {
    const limit = lim(q);
    const [profile] = await this.db.select({ localityId: userProfiles.localityId }).from(userProfiles).where(eq(userProfiles.userId, actor.userId));
    const locality = q.localityId ?? profile?.localityId ?? null;
    const myGroups = this.db.select({ id: groupMemberships.groupId }).from(groupMemberships).where(and(eq(groupMemberships.userId, actor.userId), eq(groupMemberships.status, 'active')));
    const banned = this.db.select({ id: groupMemberships.groupId }).from(groupMemberships).where(and(eq(groupMemberships.userId, actor.userId), eq(groupMemberships.status, 'banned')));
    const localPublic = locality
      ? this.db.select({ id: communityGroups.id }).from(communityGroups).where(and(eq(communityGroups.localityId, locality), eq(communityGroups.visibility, 'public'), eq(communityGroups.status, 'active')))
      : null;
    const blocked = await this.policy.blockedIds(actor.userId);
    const rows = await this.db
      .select()
      .from(posts)
      .where(
        and(
          eq(posts.status, 'published'),
          localPublic ? or(inArray(posts.groupId, myGroups), inArray(posts.groupId, localPublic)) : inArray(posts.groupId, myGroups),
          notInArray(posts.groupId, banned),
          blocked.length ? notInArray(posts.authorId, blocked) : undefined,
          q.kind ? eq(posts.kind, q.kind as PostKind) : undefined,
          keyset(posts.createdAt, posts.id, q.cursor),
        ),
      )
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(limit + 1);
    const page = pageOf(rows, limit, (r) => [r.createdAt, r.id]);
    return { ...page, items: await this.withAuthors(actor, page.items) };
  }

  async groupPosts(actor: Actor, groupId: string, q: CursorQuery & { kind?: string }) {
    if (!(await this.policy.canReadGroup(actor.userId, groupId))) throw notFound('Group');
    const limit = lim(q);
    const isStaff = await this.policy.isGroupStaff(actor.userId, groupId);
    const blocked = await this.policy.blockedIds(actor.userId);
    const rows = await this.db
      .select()
      .from(posts)
      .where(
        and(
          eq(posts.groupId, groupId),
          isStaff ? inArray(posts.status, ['published', 'hidden']) : or(eq(posts.status, 'published'), and(eq(posts.status, 'hidden'), eq(posts.authorId, actor.userId))),
          blocked.length ? notInArray(posts.authorId, blocked) : undefined,
          q.kind ? eq(posts.kind, q.kind as PostKind) : undefined,
          keyset(posts.createdAt, posts.id, q.cursor),
        ),
      )
      .orderBy(desc(posts.createdAt), desc(posts.id))
      .limit(limit + 1);
    const page = pageOf(rows, limit, (r) => [r.createdAt, r.id]);
    const pinned = q.cursor ? [] : await this.db.select().from(posts).where(and(eq(posts.groupId, groupId), eq(posts.status, 'published'), sql`${posts.pinnedAt} is not null`)).orderBy(desc(posts.pinnedAt)).limit(3);
    return { ...page, pinned: await this.withAuthors(actor, pinned), items: await this.withAuthors(actor, page.items) };
  }

  async createPost(actor: Actor, groupId: string, dto: PostInput & { body: string }) {
    const g = await this.group(groupId);
    if (g.status !== 'active') throw notFound('Group');
    const m = await this.policy.groupMembership(actor.userId, groupId);
    if (!m || m.status !== 'active') throw forbidden('Join the group to post', 'membership_required');
    if (g.postingPolicy === 'admins_only' && !['owner', 'admin', 'moderator'].includes(m.role)) throw forbidden('Only group admins can post here', 'admins_only');
    await this.moderation.assertCanPost(actor.userId);
    const kind = dto.kind ?? 'text';
    if (kind === 'announcement' && !['owner', 'admin', 'moderator'].includes(m.role)) throw forbidden('Only group admins can post announcements');
    if (kind === 'event' && !dto.eventStartsAt) throw badRequest('Events need a start time', 'event_time_required');
    const files = [];
    for (const aid of dto.attachmentIds ?? []) files.push(await this.attachmentsSvc.requireOwned(actor.userId, aid, ['post', 'civic']));
    const held = await this.moderation.spamCheck(actor.userId, dto.body, 'post');
    const [p] = await this.db
      .insert(posts)
      .values({
        groupId,
        authorId: actor.userId,
        kind,
        title: dto.title,
        body: dto.body,
        eventStartsAt: dto.eventStartsAt ? new Date(dto.eventStartsAt) : null,
        eventEndsAt: dto.eventEndsAt ? new Date(dto.eventEndsAt) : null,
        eventLocationText: dto.eventLocationText,
        status: held ? 'hidden' : 'published',
      })
      .returning();
    for (const f of files) await this.db.insert(postAttachments).values({ postId: p.id, attachmentId: f.id });
    if (held) await this.moderation.systemReport('post', p.id, actor.userId, groupId, held);
    return {
      ...(await this.withAuthors(actor, [p]))[0],
      heldForReview: !!held,
      privacyWarning: addressWarning(`${dto.title ?? ''} ${dto.body} ${dto.eventLocationText ?? ''}`),
    };
  }

  private async loadPost(id: string) {
    const [p] = await this.db.select().from(posts).where(eq(posts.id, id));
    if (!p) throw notFound('Post');
    return p;
  }

  async getPost(actor: Actor, id: string) {
    const p = await this.loadPost(id);
    if (!(await this.postVisible(actor, p))) throw notFound('Post');
    return (await this.withAuthors(actor, [p]))[0];
  }

  async updatePost(actor: Actor, id: string, dto: PostInput) {
    const p = await this.loadPost(id);
    if (p.authorId !== actor.userId || p.status === 'deleted' || p.status === 'removed') throw notFound('Post');
    await this.moderation.assertCanPost(actor.userId);
    const [u] = await this.db
      .update(posts)
      .set({
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.body !== undefined ? { body: dto.body } : {}),
        ...(dto.eventStartsAt !== undefined ? { eventStartsAt: new Date(dto.eventStartsAt) } : {}),
        ...(dto.eventEndsAt !== undefined ? { eventEndsAt: new Date(dto.eventEndsAt) } : {}),
        ...(dto.eventLocationText !== undefined ? { eventLocationText: dto.eventLocationText } : {}),
        editedAt: new Date(),
      })
      .where(eq(posts.id, id))
      .returning();
    return u;
  }

  /** Author deletes; group admins use moderate (hide/remove) instead. */
  async deletePost(actor: Actor, id: string) {
    const p = await this.loadPost(id);
    if (p.authorId !== actor.userId) throw notFound('Post');
    await this.db.update(posts).set({ status: 'deleted', body: '', title: null }).where(eq(posts.id, id));
  }

  async pinPost(actor: Actor, id: string, pinned: boolean) {
    const p = await this.loadPost(id);
    await this.requireGroupAdmin(actor, p.groupId, true);
    const [u] = await this.db.update(posts).set({ pinnedAt: pinned ? new Date() : null }).where(eq(posts.id, id)).returning();
    return u;
  }

  /** Group-level moderation by the group's own admins/moderators. */
  async moderatePost(actor: Actor, id: string, action: 'hide' | 'remove' | 'restore', reason: string) {
    const p = await this.loadPost(id);
    await this.requireGroupAdmin(actor, p.groupId, true);
    return this.moderation.act(actor, { targetType: 'post', targetId: id, action, reason }, 'group');
  }

  // ------------------------------------------------------------------ comments
  async comments(actor: Actor, postId: string, q: CursorQuery) {
    const p = await this.loadPost(postId);
    if (!(await this.postVisible(actor, p))) throw notFound('Post');
    const limit = lim(q);
    const blocked = await this.policy.blockedIds(actor.userId);
    const isStaff = await this.policy.isGroupStaff(actor.userId, p.groupId);
    const rows = await this.db
      .select({ id: comments.id, postId: comments.postId, authorId: comments.authorId, parentCommentId: comments.parentCommentId, body: comments.body, status: comments.status, editedAt: comments.editedAt, createdAt: comments.createdAt, authorName: userProfiles.displayName })
      .from(comments)
      .innerJoin(userProfiles, eq(userProfiles.userId, comments.authorId))
      .where(
        and(
          eq(comments.postId, postId),
          isStaff ? inArray(comments.status, ['published', 'hidden']) : or(eq(comments.status, 'published'), and(eq(comments.status, 'hidden'), eq(comments.authorId, actor.userId))),
          blocked.length ? notInArray(comments.authorId, blocked) : undefined,
          keyset(comments.createdAt, comments.id, q.cursor, 'asc'),
        ),
      )
      .orderBy(asc(comments.createdAt), asc(comments.id))
      .limit(limit + 1);
    return pageOf(rows, limit, (r) => [r.createdAt, r.id]);
  }

  async addComment(actor: Actor, postId: string, body: string, parentCommentId?: string) {
    const p = await this.loadPost(postId);
    if (p.status !== 'published' || !(await this.postVisible(actor, p))) throw notFound('Post');
    const m = await this.policy.groupMembership(actor.userId, p.groupId);
    if (!m || m.status !== 'active') throw forbidden('Join the group to comment', 'membership_required');
    await this.moderation.assertCanPost(actor.userId);
    if (parentCommentId) {
      const [parent] = await this.db.select({ id: comments.id }).from(comments).where(and(eq(comments.id, parentCommentId), eq(comments.postId, postId)));
      if (!parent) throw notFound('Comment');
    }
    const held = await this.moderation.spamCheck(actor.userId, body, 'comment');
    const [c] = await this.db.insert(comments).values({ postId, authorId: actor.userId, body, parentCommentId, status: held ? 'hidden' : 'published' }).returning();
    if (held) await this.moderation.systemReport('comment', c.id, actor.userId, p.groupId, held);
    else {
      await this.db.update(posts).set({ commentCount: sql`${posts.commentCount} + 1` }).where(eq(posts.id, postId));
      if (p.authorId !== actor.userId && !(await this.policy.isBlockedEitherWay(actor.userId, p.authorId))) {
        const name = await this.people.displayName(actor.userId);
        await this.notifications.notify({ userId: p.authorId, category: 'community', template: 'post_comment', title: `${name} commented on your post`, data: { type: 'post', id: postId } });
      }
    }
    return { ...c, heldForReview: !!held };
  }

  async updateComment(actor: Actor, id: string, body: string) {
    const [c] = await this.db.update(comments).set({ body, editedAt: new Date() }).where(and(eq(comments.id, id), eq(comments.authorId, actor.userId), eq(comments.status, 'published'))).returning();
    if (!c) throw notFound('Comment');
    return c;
  }

  async deleteComment(actor: Actor, id: string) {
    const [c] = await this.db.select({ c: comments, groupId: posts.groupId }).from(comments).innerJoin(posts, eq(posts.id, comments.postId)).where(eq(comments.id, id));
    if (!c) throw notFound('Comment');
    const isAuthor = c.c.authorId === actor.userId;
    if (!isAuthor && !(await this.policy.isGroupStaff(actor.userId, c.groupId))) throw notFound('Comment');
    if (isAuthor) {
      await this.db.update(comments).set({ status: 'deleted', body: '' }).where(eq(comments.id, id));
    } else {
      await this.moderation.act(actor, { targetType: 'comment', targetId: id, action: 'remove', reason: 'Removed by group moderator' }, 'group');
    }
    if (c.c.status === 'published') await this.db.update(posts).set({ commentCount: sql`greatest(${posts.commentCount} - 1, 0)` }).where(eq(posts.id, c.c.postId));
  }

  // ------------------------------------------------------------------ reactions & bookmarks
  async react(actor: Actor, postId: string, kind: 'like' | 'helpful' | 'thanks' | 'support') {
    const p = await this.loadPost(postId);
    if (p.status !== 'published' || !(await this.postVisible(actor, p))) throw notFound('Post');
    const existing = await this.db.select().from(reactions).where(and(eq(reactions.postId, postId), eq(reactions.userId, actor.userId)));
    await this.db.insert(reactions).values({ postId, userId: actor.userId, kind }).onConflictDoUpdate({ target: [reactions.postId, reactions.userId], set: { kind } });
    if (!existing.length) await this.db.update(posts).set({ reactionCount: sql`${posts.reactionCount} + 1` }).where(eq(posts.id, postId));
    return { postId, kind };
  }

  async unreact(actor: Actor, postId: string) {
    const res = await this.db.delete(reactions).where(and(eq(reactions.postId, postId), eq(reactions.userId, actor.userId))).returning();
    if (res.length) await this.db.update(posts).set({ reactionCount: sql`greatest(${posts.reactionCount} - 1, 0)` }).where(eq(posts.id, postId));
  }

  async reactionSummary(actor: Actor, postId: string) {
    const p = await this.loadPost(postId);
    if (!(await this.postVisible(actor, p))) throw notFound('Post');
    return this.db.select({ kind: reactions.kind, count: sql<number>`count(*)::int` }).from(reactions).where(eq(reactions.postId, postId)).groupBy(reactions.kind);
  }

  async bookmark(actor: Actor, postId: string) {
    const p = await this.loadPost(postId);
    if (!(await this.postVisible(actor, p))) throw notFound('Post');
    await this.db.insert(bookmarks).values({ userId: actor.userId, postId }).onConflictDoNothing();
    return { postId, bookmarked: true };
  }

  async unbookmark(actor: Actor, postId: string) {
    await this.db.delete(bookmarks).where(and(eq(bookmarks.userId, actor.userId), eq(bookmarks.postId, postId)));
  }

  async bookmarks(actor: Actor, q: CursorQuery) {
    const limit = lim(q);
    const rows = await this.db
      .select({ post: posts, savedAt: bookmarks.createdAt })
      .from(bookmarks)
      .innerJoin(posts, eq(posts.id, bookmarks.postId))
      .where(and(eq(bookmarks.userId, actor.userId), eq(posts.status, 'published'), keyset(bookmarks.createdAt, bookmarks.postId, q.cursor)))
      .orderBy(desc(bookmarks.createdAt), desc(bookmarks.postId))
      .limit(limit + 1);
    const page = pageOf(rows, limit, (r) => [r.savedAt, r.post.id]);
    const visible = [];
    for (const r of page.items) if (await this.policy.canReadGroup(actor.userId, r.post.groupId)) visible.push(r.post);
    return { items: await this.withAuthors(actor, visible), nextCursor: page.nextCursor };
  }

  // ------------------------------------------------------------------ blocking
  async blocks(actor: Actor) {
    return this.db
      .select({ userId: userBlocks.blockedId, displayName: userProfiles.displayName, createdAt: userBlocks.createdAt })
      .from(userBlocks)
      .innerJoin(userProfiles, eq(userProfiles.userId, userBlocks.blockedId))
      .where(eq(userBlocks.blockerId, actor.userId));
  }

  async block(actor: Actor, userId: string) {
    if (userId === actor.userId) throw badRequest('You cannot block yourself', 'self_block');
    await this.db.insert(userBlocks).values({ blockerId: actor.userId, blockedId: userId }).onConflictDoNothing();
    await this.audit.record(actor, { action: 'user.blocked', targetType: 'user', targetId: userId, subjectUserId: actor.userId });
    return { userId, blocked: true };
  }

  async unblock(actor: Actor, userId: string) {
    await this.db.delete(userBlocks).where(and(eq(userBlocks.blockerId, actor.userId), eq(userBlocks.blockedId, userId)));
  }

  /** Visibility check used by the report endpoint so users can only report what they can see. */
  async canSeeTarget(actor: Actor, type: TargetType, id: string): Promise<boolean> {
    if (type === 'post') {
      const [p] = await this.db.select().from(posts).where(eq(posts.id, id));
      return !!p && p.status !== 'deleted' && (await this.policy.canReadGroup(actor.userId, p.groupId));
    }
    if (type === 'comment') {
      const [c] = await this.db.select({ groupId: posts.groupId }).from(comments).innerJoin(posts, eq(posts.id, comments.postId)).where(eq(comments.id, id));
      return !!c && (await this.policy.canReadGroup(actor.userId, c.groupId));
    }
    if (type === 'group') {
      const [g] = await this.db.select().from(communityGroups).where(eq(communityGroups.id, id));
      return !!g && (g.visibility !== 'invite_only' || (await this.policy.groupMembership(actor.userId, id))?.status === 'active');
    }
    return true;
  }

  // ------------------------------------------------------------------ civic issues
  async civicList(actor: Actor) {
    return this.db
      .select({ issue: civicIssues, channelName: officialChannels.name })
      .from(civicIssues)
      .leftJoin(officialChannels, eq(officialChannels.id, civicIssues.officialChannelId))
      .where(eq(civicIssues.reporterId, actor.userId))
      .orderBy(desc(civicIssues.createdAt));
  }

  async civicCreate(actor: Actor, dto: { category: string; description: string; locationText?: string; localityId?: string; officialChannelId?: string }) {
    if (dto.officialChannelId) {
      const [c] = await this.db.select({ id: officialChannels.id }).from(officialChannels).where(eq(officialChannels.id, dto.officialChannelId));
      if (!c) throw notFound('Official channel');
    }
    const [profile] = await this.db.select({ l: userProfiles.localityId }).from(userProfiles).where(eq(userProfiles.userId, actor.userId));
    const [i] = await this.db
      .insert(civicIssues)
      .values({ reporterId: actor.userId, category: dto.category as 'other', description: dto.description, locationText: dto.locationText, localityId: dto.localityId ?? profile?.l ?? null, officialChannelId: dto.officialChannelId })
      .returning();
    return { ...i, suggestedChannels: await this.suggestChannels(dto.category, await this.policy.countryOf(actor.userId)), notice: 'This is your record. Submit it on the official channel, then add the reference number you receive.' };
  }

  async suggestChannels(category: string, country?: string | null) {
    return this.db
      .select()
      .from(officialChannels)
      .where(and(eq(officialChannels.active, true), forCountry(officialChannels.country, country), inArray(officialChannels.kind, ['civic', 'government']), or(sql`${category} = any(${officialChannels.topics})`, isNull(officialChannels.topics))))
      .limit(10);
  }

  private async civic(actor: Actor, id: string) {
    const [i] = await this.db.select().from(civicIssues).where(and(eq(civicIssues.id, id), eq(civicIssues.reporterId, actor.userId)));
    if (!i) throw notFound('Civic issue');
    return i;
  }

  async civicGet(actor: Actor, id: string) {
    const i = await this.civic(actor, id);
    return { ...i, suggestedChannels: await this.suggestChannels(i.category, await this.policy.countryOf(actor.userId)) };
  }

  /** The user records that THEY reported it on an official channel, with the reference they received. */
  async civicUpdate(actor: Actor, id: string, dto: { description?: string; locationText?: string; status?: 'draft' | 'reported_by_user' | 'in_progress' | 'resolved' | 'closed'; externalReference?: string; officialChannelId?: string }) {
    const i = await this.civic(actor, id);
    if (dto.status === 'reported_by_user' && !(dto.officialChannelId ?? i.officialChannelId)) throw badRequest('Choose which official channel you used', 'channel_required');
    const [u] = await this.db
      .update(civicIssues)
      .set({
        ...Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)),
        ...(dto.status === 'reported_by_user' && !i.reportedAt ? { reportedAt: new Date() } : {}),
      } as Partial<typeof civicIssues.$inferInsert>)
      .where(eq(civicIssues.id, id))
      .returning();
    return u;
  }

  async civicDelete(actor: Actor, id: string) {
    await this.civic(actor, id);
    await this.db.delete(civicIssues).where(eq(civicIssues.id, id));
  }

  /** Share the issue to a group as a civic_info post (approximate location only). */
  async civicShare(actor: Actor, id: string, groupId: string) {
    const i = await this.civic(actor, id);
    const post = await this.createPost(actor, groupId, {
      kind: 'civic_info',
      title: `Civic issue: ${i.category.replace('_', ' ')}`,
      body: `${i.description}${i.locationText ? `\nNear: ${i.locationText}` : ''}${i.externalReference ? `\nOfficial reference: ${i.externalReference}` : ''}`,
    });
    await this.db.update(civicIssues).set({ postId: post.id }).where(eq(civicIssues.id, id));
    return post;
  }
}
