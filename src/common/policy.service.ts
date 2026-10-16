import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, isNull, lte, or } from 'drizzle-orm';
import { Database, DB, DbOrTx } from '../db/db';
import {
  accessGrants,
  communityGroups,
  groupMemberships,
  householdMembers,
  providerMembers,
  taskAssignments,
  trustedContacts,
  userBlocks,
} from '../db/schema';
import { notFound } from './errors';

export type GrantScope =
  | 'tasks.view'
  | 'tasks.assign'
  | 'calendar.view'
  | 'checkins.view'
  | 'checkins.alerts'
  | 'help.alerts'
  | 'help.location';

export const ALL_SCOPES: GrantScope[] = [
  'tasks.view',
  'tasks.assign',
  'calendar.view',
  'checkins.view',
  'checkins.alerts',
  'help.alerts',
  'help.location',
];

/**
 * Single place for "may actor X touch resource Y" questions.
 * Callers translate a `false` into a 404 so that existence is not leaked.
 */
@Injectable()
export class PolicyService {
  constructor(@Inject(DB) private readonly db: Database) {}

  private liveGrant() {
    const now = new Date();
    return and(
      inArray(accessGrants.status, ['active', 'pending_cooloff']),
      lte(accessGrants.effectiveAt, now),
      or(isNull(accessGrants.expiresAt), gt(accessGrants.expiresAt, now)),
    );
  }

  /** True if `grantorId` has an effective grant of `scope` to `granteeId`. */
  async hasGrant(granteeId: string, grantorId: string, scope: GrantScope, tx: DbOrTx = this.db): Promise<boolean> {
    if (granteeId === grantorId) return true;
    const [row] = await tx
      .select({ id: accessGrants.id })
      .from(accessGrants)
      .where(and(eq(accessGrants.granteeId, granteeId), eq(accessGrants.grantorId, grantorId), eq(accessGrants.scope, scope), this.liveGrant()))
      .limit(1);
    return !!row;
  }

  /** Users who granted `scope` to `granteeId`. */
  async grantorsOf(granteeId: string, scope: GrantScope): Promise<string[]> {
    const rows = await this.db
      .select({ id: accessGrants.grantorId })
      .from(accessGrants)
      .where(and(eq(accessGrants.granteeId, granteeId), eq(accessGrants.scope, scope), this.liveGrant()));
    return rows.map((r) => r.id);
  }

  /** Users to whom `grantorId` granted `scope`. */
  async granteesOf(grantorId: string, scope: GrantScope, tx: DbOrTx = this.db): Promise<string[]> {
    const rows = await tx
      .select({ id: accessGrants.granteeId })
      .from(accessGrants)
      .where(and(eq(accessGrants.grantorId, grantorId), eq(accessGrants.scope, scope), this.liveGrant()));
    return rows.map((r) => r.id);
  }

  async requireGrant(granteeId: string, grantorId: string, scope: GrantScope, what = 'Resource') {
    if (!(await this.hasGrant(granteeId, grantorId, scope))) throw notFound(what);
  }

  // ------------------------------------------------------------ households
  async householdRole(userId: string, householdId: string, tx: DbOrTx = this.db): Promise<'admin' | 'member' | null> {
    const [row] = await tx
      .select({ role: householdMembers.role })
      .from(householdMembers)
      .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)))
      .limit(1);
    return row?.role ?? null;
  }

  async requireHouseholdMember(userId: string, householdId: string) {
    const role = await this.householdRole(userId, householdId);
    if (!role) throw notFound('Household');
    return role;
  }

  async requireHouseholdAdmin(userId: string, householdId: string) {
    const role = await this.requireHouseholdMember(userId, householdId);
    if (role !== 'admin') throw notFound('Household');
    return role;
  }

  async householdIdsOf(userId: string): Promise<string[]> {
    const rows = await this.db.select({ id: householdMembers.householdId }).from(householdMembers).where(eq(householdMembers.userId, userId));
    return rows.map((r) => r.id);
  }

  async shareHousehold(a: string, b: string): Promise<boolean> {
    if (a === b) return true;
    const mine = await this.householdIdsOf(a);
    if (!mine.length) return false;
    const [row] = await this.db
      .select({ id: householdMembers.householdId })
      .from(householdMembers)
      .where(and(eq(householdMembers.userId, b), inArray(householdMembers.householdId, mine)))
      .limit(1);
    return !!row;
  }

  // ------------------------------------------------------------ contacts
  async isTrustedContact(userId: string, contactUserId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: trustedContacts.id })
      .from(trustedContacts)
      .where(and(eq(trustedContacts.userId, userId), eq(trustedContacts.contactUserId, contactUserId), isNull(trustedContacts.removedAt)))
      .limit(1);
    return !!row;
  }

  // ------------------------------------------------------------ tasks
  /**
   * Task visibility:
   *  - owner always
   *  - household tasks: any household member
   *  - personal tasks: assignees, and grantees holding tasks.view when the task is marked 'shared'
   */
  async canViewTask(userId: string, task: { id: string; ownerUserId: string; householdId: string | null; visibility: string }) {
    if (task.ownerUserId === userId) return true;
    if (task.householdId && (await this.householdRole(userId, task.householdId))) return true;
    const [assigned] = await this.db
      .select({ id: taskAssignments.id })
      .from(taskAssignments)
      .where(and(eq(taskAssignments.taskId, task.id), eq(taskAssignments.assigneeUserId, userId)))
      .limit(1);
    if (assigned) return true;
    return task.visibility === 'shared' && (await this.hasGrant(userId, task.ownerUserId, 'tasks.view'));
  }

  /** Full edit (title, due date, delete): owner, or household admin for household tasks. */
  async canEditTask(userId: string, task: { ownerUserId: string; householdId: string | null }) {
    if (task.ownerUserId === userId) return true;
    return !!task.householdId && (await this.householdRole(userId, task.householdId)) === 'admin';
  }

  // ------------------------------------------------------------ community
  async groupMembership(userId: string, groupId: string) {
    const [row] = await this.db
      .select({ role: groupMemberships.role, status: groupMemberships.status })
      .from(groupMemberships)
      .where(and(eq(groupMemberships.groupId, groupId), eq(groupMemberships.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  /** Can the user read the group's posts? Public groups: anyone signed in. Others: active members. */
  async canReadGroup(userId: string, groupId: string) {
    const [g] = await this.db
      .select({ visibility: communityGroups.visibility, status: communityGroups.status })
      .from(communityGroups)
      .where(eq(communityGroups.id, groupId))
      .limit(1);
    if (!g || g.status === 'archived') return false;
    const m = await this.groupMembership(userId, groupId);
    if (m?.status === 'banned') return false;
    if (g.visibility === 'public') return true;
    return m?.status === 'active';
  }

  async isGroupStaff(userId: string, groupId: string) {
    const m = await this.groupMembership(userId, groupId);
    return !!m && m.status === 'active' && ['owner', 'admin', 'moderator'].includes(m.role);
  }

  async isBlockedEitherWay(a: string, b: string): Promise<boolean> {
    const [row] = await this.db
      .select({ a: userBlocks.blockerId })
      .from(userBlocks)
      .where(
        or(and(eq(userBlocks.blockerId, a), eq(userBlocks.blockedId, b)), and(eq(userBlocks.blockerId, b), eq(userBlocks.blockedId, a))),
      )
      .limit(1);
    return !!row;
  }

  async blockedIds(userId: string): Promise<string[]> {
    const rows = await this.db
      .select({ a: userBlocks.blockerId, b: userBlocks.blockedId })
      .from(userBlocks)
      .where(or(eq(userBlocks.blockerId, userId), eq(userBlocks.blockedId, userId)));
    return rows.map((r) => (r.a === userId ? r.b : r.a));
  }

  // ------------------------------------------------------------ providers
  async providerRole(userId: string, providerId: string): Promise<'owner' | 'staff' | null> {
    const [row] = await this.db
      .select({ role: providerMembers.role })
      .from(providerMembers)
      .where(and(eq(providerMembers.providerId, providerId), eq(providerMembers.userId, userId)))
      .limit(1);
    return row?.role ?? null;
  }

  async requireProviderMember(userId: string, providerId: string, ownerOnly = false) {
    const role = await this.providerRole(userId, providerId);
    if (!role || (ownerOnly && role !== 'owner')) throw notFound('Provider');
    return role;
  }

  async providerIdsOf(userId: string): Promise<string[]> {
    const rows = await this.db.select({ id: providerMembers.providerId }).from(providerMembers).where(eq(providerMembers.userId, userId));
    return rows.map((r) => r.id);
  }
}
