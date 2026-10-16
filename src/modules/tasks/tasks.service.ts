import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lt, lte, ne, or, SQL, sql } from 'drizzle-orm';
import { AuditService } from '../../common/audit.service';
import { Actor } from '../../common/auth-context';
import { escapeLike } from '../../common/dto';
import { badRequest, notFound, unprocessable } from '../../common/errors';
import { keyset, lim, pageOf } from '../../common/pagination';
import { PolicyService } from '../../common/policy.service';
import { nextOccurrence, normalizeRule, parseRule } from '../../common/recurrence';
import { Database, DB } from '../../db/db';
import { attachments, reminders, taskAssignments, taskAttachments, taskCategories, tasks, userProfiles } from '../../db/schema';
import { AttachmentsService } from '../attachments/attachments.service';
import { NotificationsService } from '../notifications/notifications.service';
import { InviteHelper } from '../households/households.service';
import { RemindersService } from '../reminders/reminders.service';
import { TaskCategoryDto, CreateTaskDto, TaskQuery, UpdateTaskCategoryDto, UpdateTaskDto } from './tasks.dto';

type Task = typeof tasks.$inferSelect;

@Injectable()
export class TasksService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly reminders: RemindersService,
    private readonly attachments: AttachmentsService,
    private readonly notifications: NotificationsService,
    private readonly people: InviteHelper,
  ) {}

  private async load(id: string): Promise<Task> {
    const [t] = await this.db.select().from(tasks).where(and(eq(tasks.id, id), isNull(tasks.deletedAt)));
    if (!t) throw notFound('Task');
    return t;
  }

  async requireView(actor: Actor, id: string) {
    const t = await this.load(id);
    if (!(await this.policy.canViewTask(actor.userId, t))) throw notFound('Task');
    return t;
  }

  async requireEdit(actor: Actor, id: string) {
    const t = await this.load(id);
    if (!(await this.policy.canEditTask(actor.userId, t))) throw notFound('Task');
    return t;
  }

  /** Who may mark it done / change status: editors, household members, accepted assignees. */
  private async canWork(actor: Actor, t: Task) {
    if (await this.policy.canEditTask(actor.userId, t)) return true;
    if (t.householdId && (await this.policy.householdRole(actor.userId, t.householdId))) return true;
    const [a] = await this.db
      .select({ id: taskAssignments.id })
      .from(taskAssignments)
      .where(and(eq(taskAssignments.taskId, t.id), eq(taskAssignments.assigneeUserId, actor.userId), eq(taskAssignments.status, 'accepted')))
      .limit(1);
    return !!a;
  }

  private async checkCategory(actor: Actor, categoryId: string, householdId: string | null) {
    const [c] = await this.db.select().from(taskCategories).where(eq(taskCategories.id, categoryId));
    const ok = c && (c.ownerUserId === actor.userId || (c.householdId && c.householdId === householdId));
    if (!ok) throw notFound('Category');
  }

  async create(actor: Actor, dto: CreateTaskDto) {
    if (dto.householdId) await this.policy.requireHouseholdMember(actor.userId, dto.householdId);
    if (dto.categoryId) await this.checkCategory(actor, dto.categoryId, dto.householdId ?? null);
    const dueAt = dto.dueAt ? new Date(dto.dueAt) : null;
    let rule: string | null = null;
    if (dto.recurrenceRule) {
      if (!dueAt) throw badRequest('Recurring tasks need a due date', 'recurrence_requires_due');
      parseRule(dto.recurrenceRule, dueAt);
      rule = normalizeRule(dto.recurrenceRule);
    }
    const visibility = dto.visibility ?? (dto.householdId ? 'household' : 'private');
    if (visibility === 'household' && !dto.householdId) throw badRequest("Use visibility 'household' only for household tasks", 'invalid_visibility');
    const attachmentsToLink: { id: string }[] = [];
    for (const aid of dto.attachmentIds ?? []) attachmentsToLink.push(await this.attachments.requireOwned(actor.userId, aid, ['task']));

    const task = await this.db.transaction(async (tx) => {
      const [t] = await tx
        .insert(tasks)
        .values({
          ownerUserId: actor.userId,
          householdId: dto.householdId ?? null,
          title: dto.title,
          notes: dto.notes,
          categoryId: dto.categoryId,
          priority: dto.priority ?? 'normal',
          visibility,
          dueAt,
          allDay: dto.allDay ?? false,
          recurrenceRule: rule,
          isChore: dto.isChore ?? !!(dto.householdId && rule),
          createdBy: actor.userId,
        })
        .returning();
      if (rule) await tx.update(tasks).set({ seriesId: t.id }).where(eq(tasks.id, t.id));
      for (const a of attachmentsToLink) await tx.insert(taskAttachments).values({ taskId: t.id, attachmentId: a.id });
      return { ...t, seriesId: rule ? t.id : null };
    });

    for (const uid of dto.assigneeUserIds ?? []) await this.assign(actor, task.id, uid);
    if (dueAt && dto.reminderMinutesBefore !== undefined) {
      const fireAt = new Date(dueAt.getTime() - dto.reminderMinutesBefore * 60_000);
      if (fireAt.getTime() > Date.now()) await this.reminders.create(actor.userId, { title: dto.title, fireAt, taskId: task.id });
    }
    return this.detail(actor, task.id);
  }

  async detail(actor: Actor, id: string) {
    const t = await this.requireView(actor, id);
    const assignments = await this.db
      .select({ id: taskAssignments.id, userId: taskAssignments.assigneeUserId, displayName: userProfiles.displayName, status: taskAssignments.status, assignedBy: taskAssignments.assignedBy })
      .from(taskAssignments)
      .innerJoin(userProfiles, eq(userProfiles.userId, taskAssignments.assigneeUserId))
      .where(eq(taskAssignments.taskId, id));
    const files = await this.db
      .select({ id: attachments.id, originalName: attachments.originalName, mimeType: attachments.mimeType, sizeBytes: attachments.sizeBytes })
      .from(taskAttachments)
      .innerJoin(attachments, eq(attachments.id, taskAttachments.attachmentId))
      .where(eq(taskAttachments.taskId, id));
    const myReminders = await this.db
      .select({ id: reminders.id, fireAt: reminders.fireAt, status: reminders.status })
      .from(reminders)
      .where(and(eq(reminders.taskId, id), eq(reminders.userId, actor.userId)));
    return {
      ...t,
      overdue: !!t.dueAt && t.dueAt < new Date() && (t.status === 'pending' || t.status === 'in_progress'),
      canEdit: await this.policy.canEditTask(actor.userId, t),
      assignments,
      attachments: files,
      reminders: myReminders,
    };
  }

  async list(actor: Actor, q: TaskQuery) {
    const limit = lim(q);
    const scope = q.scope ?? 'all';
    const householdIds = await this.policy.householdIdsOf(actor.userId);
    const assigned = this.db
      .select({ id: taskAssignments.taskId })
      .from(taskAssignments)
      .where(and(eq(taskAssignments.assigneeUserId, actor.userId), ne(taskAssignments.status, 'declined')));

    const scopes: (SQL | undefined)[] = [];
    if (scope === 'mine' || scope === 'all') scopes.push(and(eq(tasks.ownerUserId, actor.userId), isNull(tasks.householdId)));
    if (scope === 'household' || scope === 'all') {
      const hh = q.householdId ? (householdIds.includes(q.householdId) ? [q.householdId] : []) : householdIds;
      if (q.householdId && !hh.length) throw notFound('Household');
      if (hh.length) scopes.push(inArray(tasks.householdId, hh));
    }
    if (scope === 'assigned' || scope === 'all') scopes.push(inArray(tasks.id, assigned));
    if (scope === 'shared') {
      const owners = await this.policy.grantorsOf(actor.userId, 'tasks.view');
      const allowed = q.ownerUserId ? owners.filter((o) => o === q.ownerUserId) : owners;
      if (q.ownerUserId && !allowed.length) throw notFound('Tasks');
      if (allowed.length) scopes.push(and(inArray(tasks.ownerUserId, allowed), eq(tasks.visibility, 'shared')));
    }
    if (!scopes.filter(Boolean).length) return { items: [], nextCursor: null };

    const now = new Date();
    const status =
      q.status === 'open'
        ? inArray(tasks.status, ['pending', 'in_progress'])
        : q.status === 'overdue'
          ? and(inArray(tasks.status, ['pending', 'in_progress']), lt(tasks.dueAt, now))
          : q.status
            ? eq(tasks.status, q.status as Task['status'])
            : undefined;
    const sortCol = q.sort === 'updated' ? tasks.updatedAt : tasks.createdAt;
    const rows = await this.db
      .select()
      .from(tasks)
      .where(
        and(
          isNull(tasks.deletedAt),
          or(...scopes),
          status,
          q.categoryId ? eq(tasks.categoryId, q.categoryId) : undefined,
          q.dueFrom ? gte(tasks.dueAt, new Date(q.dueFrom)) : undefined,
          q.dueTo ? lte(tasks.dueAt, new Date(q.dueTo)) : undefined,
          q.q ? ilike(tasks.title, `%${escapeLike(q.q)}%`) : undefined,
          q.choresOnly === 'true' ? eq(tasks.isChore, true) : undefined,
          keyset(sortCol, tasks.id, q.cursor),
        ),
      )
      .orderBy(desc(sortCol), desc(tasks.id))
      .limit(limit + 1);
    const page = pageOf(rows, limit, (r) => [q.sort === 'updated' ? r.updatedAt : r.createdAt, r.id]);
    return {
      ...page,
      items: page.items.map((t) => ({ ...t, overdue: !!t.dueAt && t.dueAt < now && (t.status === 'pending' || t.status === 'in_progress') })),
    };
  }

  async summary(actor: Actor) {
    const householdIds = await this.policy.householdIdsOf(actor.userId);
    const scope = or(
      and(eq(tasks.ownerUserId, actor.userId), isNull(tasks.householdId)),
      householdIds.length ? inArray(tasks.householdId, householdIds) : undefined,
    );
    const [r] = await this.db
      .select({
        pending: sql<number>`count(*) filter (where ${tasks.status} in ('pending','in_progress'))::int`,
        overdue: sql<number>`count(*) filter (where ${tasks.status} in ('pending','in_progress') and ${tasks.dueAt} < now())::int`,
        completedThisWeek: sql<number>`count(*) filter (where ${tasks.status} = 'completed' and ${tasks.completedAt} > now() - interval '7 days')::int`,
      })
      .from(tasks)
      .where(and(isNull(tasks.deletedAt), scope));
    return r;
  }

  async update(actor: Actor, id: string, dto: UpdateTaskDto) {
    const t = await this.load(id);
    const canEdit = await this.policy.canEditTask(actor.userId, t);
    const onlyStatus = Object.keys(dto).every((k) => k === 'status');
    if (!canEdit && !(onlyStatus && (await this.canWork(actor, t)))) throw notFound('Task');
    if (dto.categoryId) await this.checkCategory(actor, dto.categoryId, t.householdId);
    if (dto.visibility === 'household' && !t.householdId) throw badRequest("Use visibility 'household' only for household tasks", 'invalid_visibility');
    const dueAt = dto.dueAt === undefined ? t.dueAt : dto.dueAt === null ? null : new Date(dto.dueAt);
    let rule = dto.recurrenceRule === undefined ? t.recurrenceRule : dto.recurrenceRule;
    if (rule) {
      if (!dueAt) throw badRequest('Recurring tasks need a due date', 'recurrence_requires_due');
      parseRule(rule, dueAt);
      rule = normalizeRule(rule);
    }
    const patch: Partial<typeof tasks.$inferInsert> = {};
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.notes !== undefined) patch.notes = dto.notes;
    if (dto.categoryId !== undefined) patch.categoryId = dto.categoryId;
    if (dto.priority) patch.priority = dto.priority;
    if (dto.status) patch.status = dto.status;
    if (dto.dueAt !== undefined) patch.dueAt = dueAt;
    if (dto.allDay !== undefined) patch.allDay = dto.allDay;
    if (dto.recurrenceRule !== undefined) {
      patch.recurrenceRule = rule;
      patch.seriesId = rule ? (t.seriesId ?? t.id) : t.seriesId;
    }
    if (dto.visibility) patch.visibility = dto.visibility;
    if (dto.isChore !== undefined) patch.isChore = dto.isChore;
    const [u] = await this.db.update(tasks).set(patch).where(eq(tasks.id, id)).returning();
    if (dto.status === 'cancelled') await this.reminders.cancelForTask(id);
    return u;
  }

  /** Completes the task. For a recurring task, the next occurrence is created automatically. */
  async complete(actor: Actor, id: string) {
    const t = await this.load(id);
    if (!(await this.canWork(actor, t))) throw notFound('Task');
    if (t.status === 'completed') return { task: t, next: null };
    const now = new Date();
    return this.db.transaction(async (tx) => {
      const [done] = await tx
        .update(tasks)
        .set({ status: 'completed', completedAt: now, completedBy: actor.userId })
        .where(and(eq(tasks.id, id), ne(tasks.status, 'completed')))
        .returning();
      let next: Task | null = null;
      if (t.recurrenceRule && t.dueAt) {
        const nextDue = nextOccurrence(t.recurrenceRule, t.dueAt, t.dueAt);
        if (nextDue) {
          [next] = await tx
            .insert(tasks)
            .values({
              ownerUserId: t.ownerUserId,
              householdId: t.householdId,
              title: t.title,
              notes: t.notes,
              categoryId: t.categoryId,
              priority: t.priority,
              visibility: t.visibility,
              dueAt: nextDue,
              allDay: t.allDay,
              recurrenceRule: t.recurrenceRule,
              seriesId: t.seriesId ?? t.id,
              isChore: t.isChore,
              createdBy: t.createdBy,
            })
            .returning();
          // Carry accepted assignees over to the next occurrence (rotations can be done by reassigning).
          const assignees = await tx.select().from(taskAssignments).where(and(eq(taskAssignments.taskId, t.id), eq(taskAssignments.status, 'accepted')));
          for (const a of assignees) {
            await tx.insert(taskAssignments).values({ taskId: next.id, assigneeUserId: a.assigneeUserId, assignedBy: a.assignedBy, status: 'accepted' });
          }
        }
      }
      if (t.ownerUserId !== actor.userId) {
        const name = await this.people.displayName(actor.userId);
        await this.notifications.notify(
          { userId: t.ownerUserId, category: 'tasks', template: 'task_completed', title: `${name} completed "${t.title}"`, data: { type: 'task', id: t.id } },
          tx,
        );
      }
      return { task: done ?? t, next };
    });
  }

  async reopen(actor: Actor, id: string) {
    const t = await this.load(id);
    if (!(await this.canWork(actor, t))) throw notFound('Task');
    const [u] = await this.db.update(tasks).set({ status: 'pending', completedAt: null, completedBy: null }).where(eq(tasks.id, id)).returning();
    return u;
  }

  async remove(actor: Actor, id: string) {
    await this.requireEdit(actor, id);
    await this.db.update(tasks).set({ deletedAt: new Date() }).where(eq(tasks.id, id));
    await this.reminders.cancelForTask(id);
  }

  /**
   * Assign a task:
   *  - household task → any household member, accepted immediately
   *  - personal task → the assignee must have granted the owner `tasks.assign`; arrives as a proposal they accept or decline
   */
  async assign(actor: Actor, taskId: string, assigneeId: string) {
    const t = await this.requireEdit(actor, taskId);
    let status: 'accepted' | 'proposed';
    if (t.householdId) {
      if (!(await this.policy.householdRole(assigneeId, t.householdId))) throw notFound('Household member');
      status = 'accepted';
    } else {
      if (assigneeId === actor.userId) throw badRequest('You own this task already', 'self_assignment');
      if (!(await this.policy.hasGrant(actor.userId, assigneeId, 'tasks.assign'))) {
        throw notFound('Contact');
      }
      status = 'proposed';
    }
    const [a] = await this.db
      .insert(taskAssignments)
      .values({ taskId, assigneeUserId: assigneeId, assignedBy: actor.userId, status })
      .onConflictDoUpdate({ target: [taskAssignments.taskId, taskAssignments.assigneeUserId], set: { status, assignedBy: actor.userId, respondedAt: null } })
      .returning();
    if (assigneeId !== actor.userId) {
      const name = await this.people.displayName(actor.userId);
      await this.notifications.notify({
        userId: assigneeId,
        category: 'tasks',
        template: status === 'proposed' ? 'task_proposed' : 'task_assigned',
        title: status === 'proposed' ? `${name} suggested a task for you: "${t.title}"` : `${name} assigned you "${t.title}"`,
        data: { type: 'task', id: taskId },
      });
    }
    await this.audit.record(actor, { action: 'task.assigned', targetType: 'task', targetId: taskId, subjectUserId: assigneeId, metadata: { status } });
    return a;
  }

  async unassign(actor: Actor, taskId: string, assigneeId: string) {
    const t = await this.load(taskId);
    const allowed = assigneeId === actor.userId || (await this.policy.canEditTask(actor.userId, t));
    if (!allowed) throw notFound('Task');
    const res = await this.db
      .delete(taskAssignments)
      .where(and(eq(taskAssignments.taskId, taskId), eq(taskAssignments.assigneeUserId, assigneeId)))
      .returning({ id: taskAssignments.id });
    if (!res.length) throw notFound('Assignment');
  }

  async respondAssignment(actor: Actor, assignmentId: string, accept: boolean) {
    const [a] = await this.db
      .select()
      .from(taskAssignments)
      .where(and(eq(taskAssignments.id, assignmentId), eq(taskAssignments.assigneeUserId, actor.userId)));
    if (!a) throw notFound('Assignment');
    if (a.status !== 'proposed') throw unprocessable('This assignment was already answered');
    const [u] = await this.db
      .update(taskAssignments)
      .set({ status: accept ? 'accepted' : 'declined', respondedAt: new Date() })
      .where(eq(taskAssignments.id, assignmentId))
      .returning();
    const name = await this.people.displayName(actor.userId);
    const [t] = await this.db.select({ title: tasks.title }).from(tasks).where(eq(tasks.id, a.taskId));
    await this.notifications.notify({
      userId: a.assignedBy,
      category: 'tasks',
      template: accept ? 'task_assignment_accepted' : 'task_assignment_declined',
      title: `${name} ${accept ? 'accepted' : 'declined'} "${t?.title ?? 'a task'}"`,
      data: { type: 'task', id: a.taskId },
    });
    return u;
  }

  async incomingAssignments(actor: Actor) {
    return this.db
      .select({ id: taskAssignments.id, taskId: taskAssignments.taskId, title: tasks.title, dueAt: tasks.dueAt, assignedBy: taskAssignments.assignedBy, assignedByName: userProfiles.displayName, createdAt: taskAssignments.createdAt })
      .from(taskAssignments)
      .innerJoin(tasks, eq(tasks.id, taskAssignments.taskId))
      .innerJoin(userProfiles, eq(userProfiles.userId, taskAssignments.assignedBy))
      .where(and(eq(taskAssignments.assigneeUserId, actor.userId), eq(taskAssignments.status, 'proposed'), isNull(tasks.deletedAt)))
      .orderBy(desc(taskAssignments.createdAt));
  }

  async attach(actor: Actor, taskId: string, attachmentId: string) {
    await this.requireEdit(actor, taskId);
    await this.attachments.requireOwned(actor.userId, attachmentId, ['task']);
    await this.db.insert(taskAttachments).values({ taskId, attachmentId }).onConflictDoNothing();
    return { taskId, attachmentId };
  }

  async detach(actor: Actor, taskId: string, attachmentId: string) {
    await this.requireEdit(actor, taskId);
    const res = await this.db
      .delete(taskAttachments)
      .where(and(eq(taskAttachments.taskId, taskId), eq(taskAttachments.attachmentId, attachmentId)))
      .returning();
    if (!res.length) throw notFound('Attachment');
  }

  // ------------------------------------------------------------------ categories
  async categories(actor: Actor) {
    const hh = await this.policy.householdIdsOf(actor.userId);
    return this.db
      .select()
      .from(taskCategories)
      .where(or(eq(taskCategories.ownerUserId, actor.userId), hh.length ? inArray(taskCategories.householdId, hh) : undefined))
      .orderBy(asc(taskCategories.name));
  }

  async createCategory(actor: Actor, dto: TaskCategoryDto) {
    if (dto.householdId) await this.policy.requireHouseholdMember(actor.userId, dto.householdId);
    const [c] = await this.db
      .insert(taskCategories)
      .values({ ownerUserId: dto.householdId ? null : actor.userId, householdId: dto.householdId ?? null, name: dto.name, color: dto.color })
      .returning();
    return c;
  }

  private async requireCategory(actor: Actor, id: string) {
    const [c] = await this.db.select().from(taskCategories).where(eq(taskCategories.id, id));
    if (!c) throw notFound('Category');
    if (c.ownerUserId === actor.userId) return c;
    if (c.householdId && (await this.policy.householdRole(actor.userId, c.householdId)) === 'admin') return c;
    throw notFound('Category');
  }

  async updateCategory(actor: Actor, id: string, dto: UpdateTaskCategoryDto) {
    await this.requireCategory(actor, id);
    const [c] = await this.db.update(taskCategories).set(dto).where(eq(taskCategories.id, id)).returning();
    return c;
  }

  async deleteCategory(actor: Actor, id: string) {
    await this.requireCategory(actor, id);
    await this.db.delete(taskCategories).where(eq(taskCategories.id, id));
  }
}
