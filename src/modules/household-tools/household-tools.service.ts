import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { Actor } from '../../common/auth-context';
import { badRequest, notFound } from '../../common/errors';
import { PolicyService } from '../../common/policy.service';
import { addDays, toDateString } from '../../common/time';
import { Database, DB } from '../../db/db';
import {
  homeInventoryItems,
  householdBudgets,
  householdMembers,
  maintenanceRecords,
  maintenanceSchedules,
  purchases,
  shoppingListItems,
  shoppingLists,
  userProfiles,
} from '../../db/schema';
import { countryInfo } from '../../common/countries';
import { NotificationsService } from '../notifications/notifications.service';

type Owned = { ownerUserId: string; householdId: string | null };

@Injectable()
export class HouseholdToolsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly policy: PolicyService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Currency of the user's country (budgets default to it). */
  private async defaultCurrency(userId: string) {
    const [p] = await this.db.select({ country: userProfiles.country }).from(userProfiles).where(eq(userProfiles.userId, userId));
    return countryInfo(p?.country).currency;
  }

  /** Personal items: owner only. Household items: any member. */
  private async canAccess(actor: Actor, o: Owned) {
    if (o.householdId) return !!(await this.policy.householdRole(actor.userId, o.householdId));
    return o.ownerUserId === actor.userId;
  }

  private async scopeFilter(actor: Actor, householdId?: string) {
    if (householdId) {
      await this.policy.requireHouseholdMember(actor.userId, householdId);
      return { householdId, hh: [householdId] };
    }
    return { householdId: undefined, hh: await this.policy.householdIdsOf(actor.userId) };
  }

  // ------------------------------------------------------------------ shopping lists
  async lists(actor: Actor, householdId?: string, includeArchived = false) {
    const { hh } = await this.scopeFilter(actor, householdId);
    return this.db
      .select({
        id: shoppingLists.id,
        name: shoppingLists.name,
        householdId: shoppingLists.householdId,
        ownerUserId: shoppingLists.ownerUserId,
        archivedAt: shoppingLists.archivedAt,
        updatedAt: shoppingLists.updatedAt,
        openItems: sql<number>`(select count(*)::int from shopping_list_items i where i.list_id = ${shoppingLists.id} and i.done_at is null)`,
      })
      .from(shoppingLists)
      .where(
        and(
          householdId
            ? eq(shoppingLists.householdId, householdId)
            : or(and(eq(shoppingLists.ownerUserId, actor.userId), isNull(shoppingLists.householdId)), hh.length ? inArray(shoppingLists.householdId, hh) : undefined),
          includeArchived ? undefined : isNull(shoppingLists.archivedAt),
        ),
      )
      .orderBy(desc(shoppingLists.updatedAt));
  }

  async createList(actor: Actor, name: string, householdId?: string) {
    if (householdId) await this.policy.requireHouseholdMember(actor.userId, householdId);
    const [l] = await this.db.insert(shoppingLists).values({ ownerUserId: actor.userId, householdId: householdId ?? null, name }).returning();
    return l;
  }

  private async list(actor: Actor, id: string) {
    const [l] = await this.db.select().from(shoppingLists).where(eq(shoppingLists.id, id));
    if (!l || !(await this.canAccess(actor, l))) throw notFound('List');
    return l;
  }

  async getList(actor: Actor, id: string) {
    const l = await this.list(actor, id);
    const items = await this.db
      .select()
      .from(shoppingListItems)
      .where(eq(shoppingListItems.listId, id))
      .orderBy(asc(shoppingListItems.doneAt), asc(shoppingListItems.category), asc(shoppingListItems.position), asc(shoppingListItems.createdAt));
    return { ...l, items };
  }

  async updateList(actor: Actor, id: string, dto: { name?: string; archived?: boolean }) {
    await this.list(actor, id);
    const [l] = await this.db
      .update(shoppingLists)
      .set({ ...(dto.name ? { name: dto.name } : {}), ...(dto.archived !== undefined ? { archivedAt: dto.archived ? new Date() : null } : {}) })
      .where(eq(shoppingLists.id, id))
      .returning();
    return l;
  }

  async deleteList(actor: Actor, id: string) {
    const l = await this.list(actor, id);
    if (l.ownerUserId !== actor.userId && !(l.householdId && (await this.policy.householdRole(actor.userId, l.householdId)) === 'admin')) throw notFound('List');
    await this.db.delete(shoppingLists).where(eq(shoppingLists.id, id));
  }

  async addItem(actor: Actor, listId: string, dto: { name: string; quantity?: number; unit?: string; category?: string; assignedTo?: string; position?: number }) {
    const l = await this.list(actor, listId);
    if (dto.assignedTo) await this.checkAssignee(l, dto.assignedTo, actor);
    const [i] = await this.db
      .insert(shoppingListItems)
      .values({
        listId,
        name: dto.name,
        quantity: dto.quantity !== undefined ? String(dto.quantity) : null,
        unit: dto.unit,
        category: dto.category,
        assignedTo: dto.assignedTo,
        position: dto.position ?? 0,
        addedBy: actor.userId,
      })
      .returning();
    await this.db.update(shoppingLists).set({ updatedAt: new Date() }).where(eq(shoppingLists.id, listId));
    if (dto.assignedTo && dto.assignedTo !== actor.userId) {
      await this.notifications.notify({ userId: dto.assignedTo, category: 'household', template: 'grocery_assigned', title: `You were asked to pick up: ${dto.name}`, data: { type: 'shopping_list', id: listId } });
    }
    return i;
  }

  private async checkAssignee(l: Owned, userId: string, actor: Actor) {
    const ok = l.householdId ? !!(await this.policy.householdRole(userId, l.householdId)) : userId === actor.userId;
    if (!ok) throw notFound('Household member');
  }

  private async item(actor: Actor, itemId: string) {
    const [row] = await this.db
      .select({ item: shoppingListItems, list: shoppingLists })
      .from(shoppingListItems)
      .innerJoin(shoppingLists, eq(shoppingLists.id, shoppingListItems.listId))
      .where(eq(shoppingListItems.id, itemId));
    if (!row || !(await this.canAccess(actor, row.list))) throw notFound('Item');
    return row;
  }

  async updateItem(actor: Actor, itemId: string, dto: { name?: string; quantity?: number | null; unit?: string | null; category?: string | null; assignedTo?: string | null; position?: number; done?: boolean }) {
    const { list } = await this.item(actor, itemId);
    if (dto.assignedTo) await this.checkAssignee(list, dto.assignedTo, actor);
    const patch: Partial<typeof shoppingListItems.$inferInsert> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.quantity !== undefined) patch.quantity = dto.quantity === null ? null : String(dto.quantity);
    if (dto.unit !== undefined) patch.unit = dto.unit;
    if (dto.category !== undefined) patch.category = dto.category;
    if (dto.assignedTo !== undefined) patch.assignedTo = dto.assignedTo;
    if (dto.position !== undefined) patch.position = dto.position;
    if (dto.done !== undefined) {
      patch.doneAt = dto.done ? new Date() : null;
      patch.doneBy = dto.done ? actor.userId : null;
    }
    const [i] = await this.db.update(shoppingListItems).set(patch).where(eq(shoppingListItems.id, itemId)).returning();
    await this.db.update(shoppingLists).set({ updatedAt: new Date() }).where(eq(shoppingLists.id, list.id));
    return i;
  }

  async deleteItem(actor: Actor, itemId: string) {
    await this.item(actor, itemId);
    await this.db.delete(shoppingListItems).where(eq(shoppingListItems.id, itemId));
  }

  async clearDone(actor: Actor, listId: string) {
    await this.list(actor, listId);
    const res = await this.db.delete(shoppingListItems).where(and(eq(shoppingListItems.listId, listId), isNotNull(shoppingListItems.doneAt))).returning({ id: shoppingListItems.id });
    return { removed: res.length };
  }

  // ------------------------------------------------------------------ inventory
  async inventory(actor: Actor, householdId?: string, category?: string) {
    const { hh } = await this.scopeFilter(actor, householdId);
    return this.db
      .select()
      .from(homeInventoryItems)
      .where(
        and(
          isNull(homeInventoryItems.deletedAt),
          householdId
            ? eq(homeInventoryItems.householdId, householdId)
            : or(and(eq(homeInventoryItems.ownerUserId, actor.userId), isNull(homeInventoryItems.householdId)), hh.length ? inArray(homeInventoryItems.householdId, hh) : undefined),
          category ? eq(homeInventoryItems.category, category) : undefined,
        ),
      )
      .orderBy(asc(homeInventoryItems.name))
      .limit(500);
  }

  async createItem(actor: Actor, dto: InventoryInput & { householdId?: string }) {
    if (dto.householdId) await this.policy.requireHouseholdMember(actor.userId, dto.householdId);
    const [i] = await this.db
      .insert(homeInventoryItems)
      .values({ ownerUserId: actor.userId, householdId: dto.householdId ?? null, ...this.inventoryFields(dto) } as typeof homeInventoryItems.$inferInsert)
      .returning();
    return i;
  }

  private inventoryFields(dto: InventoryInput) {
    const out: Record<string, unknown> = {};
    for (const k of ['name', 'category', 'brand', 'model', 'roomOrLocation', 'installedOn', 'purchaseDate', 'warrantyExpiresOn', 'notes'] as const) {
      if (dto[k] !== undefined) out[k] = dto[k];
    }
    return out;
  }

  private async invItem(actor: Actor, id: string) {
    const [i] = await this.db.select().from(homeInventoryItems).where(and(eq(homeInventoryItems.id, id), isNull(homeInventoryItems.deletedAt)));
    if (!i || !(await this.canAccess(actor, i))) throw notFound('Item');
    return i;
  }

  async getItem(actor: Actor, id: string) {
    const i = await this.invItem(actor, id);
    const schedules = await this.db.select().from(maintenanceSchedules).where(eq(maintenanceSchedules.itemId, id)).orderBy(asc(maintenanceSchedules.nextDueOn));
    const records = await this.db.select().from(maintenanceRecords).where(eq(maintenanceRecords.itemId, id)).orderBy(desc(maintenanceRecords.performedOn)).limit(50);
    const linkedPurchases = await this.db
      .select({ id: purchases.id, warrantyExpiresOn: purchases.warrantyExpiresOn, retailerName: purchases.retailerName })
      .from(purchases)
      .where(and(eq(purchases.inventoryItemId, id), eq(purchases.ownerUserId, actor.userId), isNull(purchases.deletedAt)));
    return { ...i, schedules, records, purchases: linkedPurchases };
  }

  async updateItem2(actor: Actor, id: string, dto: InventoryInput) {
    await this.invItem(actor, id);
    const [i] = await this.db.update(homeInventoryItems).set(this.inventoryFields(dto)).where(eq(homeInventoryItems.id, id)).returning();
    return i;
  }

  async deleteInvItem(actor: Actor, id: string) {
    await this.invItem(actor, id);
    await this.db.update(homeInventoryItems).set({ deletedAt: new Date() }).where(eq(homeInventoryItems.id, id));
  }

  async addSchedule(actor: Actor, itemId: string, dto: { title: string; intervalDays: number; nextDueOn: string; reminderLeadDays?: number }) {
    await this.invItem(actor, itemId);
    const [s] = await this.db
      .insert(maintenanceSchedules)
      .values({ itemId, title: dto.title, intervalDays: dto.intervalDays, nextDueOn: dto.nextDueOn, reminderLeadDays: dto.reminderLeadDays ?? 3 })
      .returning();
    return s;
  }

  private async schedule(actor: Actor, itemId: string, scheduleId: string) {
    await this.invItem(actor, itemId);
    const [s] = await this.db.select().from(maintenanceSchedules).where(and(eq(maintenanceSchedules.id, scheduleId), eq(maintenanceSchedules.itemId, itemId)));
    if (!s) throw notFound('Schedule');
    return s;
  }

  async updateSchedule(actor: Actor, itemId: string, scheduleId: string, dto: { title?: string; intervalDays?: number; nextDueOn?: string; reminderLeadDays?: number; active?: boolean }) {
    await this.schedule(actor, itemId, scheduleId);
    const [s] = await this.db.update(maintenanceSchedules).set(dto).where(eq(maintenanceSchedules.id, scheduleId)).returning();
    return s;
  }

  async deleteSchedule(actor: Actor, itemId: string, scheduleId: string) {
    await this.schedule(actor, itemId, scheduleId);
    await this.db.delete(maintenanceSchedules).where(eq(maintenanceSchedules.id, scheduleId));
  }

  /** Log maintenance. When linked to a schedule, the schedule's next due date advances. */
  async addRecord(actor: Actor, itemId: string, dto: { performedOn: string; description: string; providerName?: string; providerId?: string; serviceRequestId?: string; scheduleId?: string }) {
    await this.invItem(actor, itemId);
    if (dto.scheduleId) {
      const s = await this.schedule(actor, itemId, dto.scheduleId);
      const next = addDays(new Date(`${dto.performedOn}T00:00:00Z`), s.intervalDays);
      await this.db.update(maintenanceSchedules).set({ nextDueOn: toDateString(next), lastReminderFor: null }).where(eq(maintenanceSchedules.id, s.id));
    }
    const [r] = await this.db.insert(maintenanceRecords).values({ itemId, createdBy: actor.userId, ...dto }).returning();
    return r;
  }

  async deleteRecord(actor: Actor, itemId: string, recordId: string) {
    await this.invItem(actor, itemId);
    const res = await this.db.delete(maintenanceRecords).where(and(eq(maintenanceRecords.id, recordId), eq(maintenanceRecords.itemId, itemId))).returning();
    if (!res.length) throw notFound('Record');
  }

  /** Worker (daily): maintenance due soon. Notifies the owner or all household members once per due date. */
  async maintenanceTick() {
    const today = new Date();
    const due = await this.db
      .select({ s: maintenanceSchedules, item: homeInventoryItems })
      .from(maintenanceSchedules)
      .innerJoin(homeInventoryItems, eq(homeInventoryItems.id, maintenanceSchedules.itemId))
      .where(
        and(
          eq(maintenanceSchedules.active, true),
          isNull(homeInventoryItems.deletedAt),
          lte(maintenanceSchedules.nextDueOn, sql`(current_date + ${maintenanceSchedules.reminderLeadDays})`),
          or(isNull(maintenanceSchedules.lastReminderFor), sql`${maintenanceSchedules.lastReminderFor} <> ${maintenanceSchedules.nextDueOn}`),
        ),
      )
      .limit(500);
    for (const { s, item } of due) {
      const recipients = item.householdId
        ? (await this.db.select({ u: householdMembers.userId }).from(householdMembers).where(eq(householdMembers.householdId, item.householdId))).map((r) => r.u)
        : [item.ownerUserId];
      for (const userId of recipients) {
        await this.notifications.notify({
          userId,
          category: 'household',
          template: 'maintenance_due',
          title: `Maintenance due ${s.nextDueOn}: ${s.title} (${item.name})`,
          data: { type: 'inventory_item', id: item.id },
        });
      }
      await this.db.update(maintenanceSchedules).set({ lastReminderFor: s.nextDueOn }).where(eq(maintenanceSchedules.id, s.id));
    }
    void today;
    return due.length;
  }

  // ------------------------------------------------------------------ budget (optional, high level, manual entry)
  async budgets(actor: Actor, month: string, householdId?: string) {
    if (householdId) await this.policy.requireHouseholdMember(actor.userId, householdId);
    return this.db
      .select()
      .from(householdBudgets)
      .where(
        and(
          eq(householdBudgets.month, month),
          householdId ? eq(householdBudgets.householdId, householdId) : and(eq(householdBudgets.ownerUserId, actor.userId), isNull(householdBudgets.householdId)),
        ),
      )
      .orderBy(asc(householdBudgets.category));
  }

  async createBudget(actor: Actor, dto: { month: string; category: string; plannedAmount: number; spentAmount?: number; currency?: string; note?: string; householdId?: string }) {
    if (!/^\d{4}-\d{2}-01$/.test(dto.month)) throw badRequest('month must be the first day of a month, e.g. 2026-10-01', 'invalid_month');
    if (dto.householdId) await this.policy.requireHouseholdMember(actor.userId, dto.householdId);
    const [b] = await this.db
      .insert(householdBudgets)
      .values({
        ownerUserId: actor.userId,
        householdId: dto.householdId ?? null,
        month: dto.month,
        category: dto.category,
        plannedAmount: String(dto.plannedAmount),
        spentAmount: String(dto.spentAmount ?? 0),
        currency: dto.currency ?? (await this.defaultCurrency(actor.userId)),
        note: dto.note,
      })
      .returning();
    return b;
  }

  private async budget(actor: Actor, id: string) {
    const [b] = await this.db.select().from(householdBudgets).where(eq(householdBudgets.id, id));
    if (!b || !(await this.canAccess(actor, b))) throw notFound('Budget line');
    return b;
  }

  async updateBudget(actor: Actor, id: string, dto: { category?: string; plannedAmount?: number; spentAmount?: number; note?: string }) {
    await this.budget(actor, id);
    const [b] = await this.db
      .update(householdBudgets)
      .set({
        ...(dto.category ? { category: dto.category } : {}),
        ...(dto.plannedAmount !== undefined ? { plannedAmount: String(dto.plannedAmount) } : {}),
        ...(dto.spentAmount !== undefined ? { spentAmount: String(dto.spentAmount) } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
      })
      .where(eq(householdBudgets.id, id))
      .returning();
    return b;
  }

  async deleteBudget(actor: Actor, id: string) {
    await this.budget(actor, id);
    await this.db.delete(householdBudgets).where(eq(householdBudgets.id, id));
  }
}

export interface InventoryInput {
  name?: string;
  category?: string;
  brand?: string;
  model?: string;
  roomOrLocation?: string;
  installedOn?: string;
  purchaseDate?: string;
  warrantyExpiresOn?: string;
  notes?: string;
}
