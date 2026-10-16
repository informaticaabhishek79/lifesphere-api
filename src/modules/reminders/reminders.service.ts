import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, lt, lte } from 'drizzle-orm';
import { Actor } from '../../common/auth-context';
import { badRequest, notFound } from '../../common/errors';
import { CursorQuery, keyset, lim, pageOf } from '../../common/pagination';
import { JOBS, QueueService } from '../../common/queue.service';
import { Database, DB } from '../../db/db';
import { calendarEvents, reminders, tasks } from '../../db/schema';
import { NotificationsService } from '../notifications/notifications.service';

export type ReminderChannel = 'in_app' | 'push' | 'email' | 'sms';

export interface CreateReminder {
  title: string;
  fireAt: Date;
  taskId?: string | null;
  eventId?: string | null;
  channels?: ReminderChannel[];
}

@Injectable()
export class RemindersService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly queue: QueueService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(userId: string, input: CreateReminder) {
    if (input.fireAt.getTime() < Date.now() - 60_000) throw badRequest('Reminder time is in the past', 'reminder_in_past');
    const [r] = await this.db
      .insert(reminders)
      .values({
        userId,
        title: input.title.slice(0, 200),
        fireAt: input.fireAt,
        taskId: input.taskId ?? null,
        eventId: input.eventId ?? null,
        channels: input.channels?.length ? input.channels : ['in_app', 'push'],
      })
      .returning();
    return this.schedule(r);
  }

  private async schedule(r: typeof reminders.$inferSelect) {
    const jobId = await this.queue.send(JOBS.reminderFire, { reminderId: r.id }, { startAfter: r.fireAt, retryLimit: 3 });
    const [u] = await this.db.update(reminders).set({ jobId }).where(eq(reminders.id, r.id)).returning();
    return u;
  }

  async list(actor: Actor, q: CursorQuery & { status?: string }) {
    const limit = lim(q);
    const rows = await this.db
      .select()
      .from(reminders)
      .where(
        and(
          eq(reminders.userId, actor.userId),
          q.status ? eq(reminders.status, q.status as 'scheduled') : undefined,
          keyset(reminders.fireAt, reminders.id, q.cursor, 'asc'),
        ),
      )
      .orderBy(asc(reminders.fireAt), asc(reminders.id))
      .limit(limit + 1);
    return pageOf(rows, limit, (r) => [r.fireAt, r.id]);
  }

  async get(actor: Actor, id: string) {
    const [r] = await this.db.select().from(reminders).where(and(eq(reminders.id, id), eq(reminders.userId, actor.userId)));
    if (!r) throw notFound('Reminder');
    return r;
  }

  async update(actor: Actor, id: string, dto: { title?: string; fireAt?: Date; channels?: ReminderChannel[] }) {
    const r = await this.get(actor, id);
    if (r.status !== 'scheduled') throw badRequest('Only scheduled reminders can be changed', 'reminder_not_scheduled');
    if (dto.fireAt && dto.fireAt.getTime() < Date.now() - 60_000) throw badRequest('Reminder time is in the past', 'reminder_in_past');
    const [u] = await this.db
      .update(reminders)
      .set({ ...(dto.title ? { title: dto.title } : {}), ...(dto.fireAt ? { fireAt: dto.fireAt } : {}), ...(dto.channels ? { channels: dto.channels } : {}) })
      .where(eq(reminders.id, id))
      .returning();
    if (dto.fireAt) {
      if (r.jobId) await this.queue.cancel(JOBS.reminderFire, r.jobId);
      return this.schedule(u);
    }
    return u;
  }

  async cancel(actor: Actor, id: string) {
    const r = await this.get(actor, id);
    if (r.jobId) await this.queue.cancel(JOBS.reminderFire, r.jobId);
    await this.db.update(reminders).set({ status: 'cancelled' }).where(eq(reminders.id, id));
  }

  async cancelForTask(taskId: string) {
    const rows = await this.db
      .update(reminders)
      .set({ status: 'cancelled' })
      .where(and(eq(reminders.taskId, taskId), eq(reminders.status, 'scheduled')))
      .returning({ jobId: reminders.jobId });
    for (const r of rows) if (r.jobId) await this.queue.cancel(JOBS.reminderFire, r.jobId);
  }

  async cancelForEvent(eventId: string) {
    const rows = await this.db
      .update(reminders)
      .set({ status: 'cancelled' })
      .where(and(eq(reminders.eventId, eventId), eq(reminders.status, 'scheduled')))
      .returning({ jobId: reminders.jobId });
    for (const r of rows) if (r.jobId) await this.queue.cancel(JOBS.reminderFire, r.jobId);
  }

  /** Worker: fire one reminder. Idempotent (status check). */
  async fire(reminderId: string) {
    const [r] = await this.db.select().from(reminders).where(eq(reminders.id, reminderId));
    if (!r || r.status !== 'scheduled') return;
    if (r.fireAt.getTime() > Date.now() + 60_000) return; // rescheduled later; the newer job will fire it
    let data: Record<string, string> = { type: 'reminder', id: r.id };
    if (r.taskId) {
      const [t] = await this.db.select({ status: tasks.status, deletedAt: tasks.deletedAt }).from(tasks).where(eq(tasks.id, r.taskId));
      if (!t || t.deletedAt || t.status === 'completed' || t.status === 'cancelled') {
        await this.db.update(reminders).set({ status: 'cancelled' }).where(eq(reminders.id, r.id));
        return;
      }
      data = { type: 'task', id: r.taskId };
    }
    if (r.eventId) {
      const [e] = await this.db.select({ cancelledAt: calendarEvents.cancelledAt }).from(calendarEvents).where(eq(calendarEvents.id, r.eventId));
      if (!e || e.cancelledAt) {
        await this.db.update(reminders).set({ status: 'cancelled' }).where(eq(reminders.id, r.id));
        return;
      }
      data = { type: 'calendar_event', id: r.eventId };
    }
    const channels = r.channels.filter((c): c is 'push' | 'email' | 'sms' => c === 'push' || c === 'email' || c === 'sms');
    await this.notifications.notify({
      userId: r.userId,
      category: 'reminders',
      template: 'reminder',
      title: r.title,
      data,
      channels,
      related: { type: 'reminder', id: r.id },
      smsText: 'You have a LifeSphere reminder',
    });
    await this.db.update(reminders).set({ status: 'sent', sentAt: new Date() }).where(eq(reminders.id, r.id));
  }

  /** Safety net: fire anything overdue that the queue missed (e.g. queue outage). */
  async sweepOverdue() {
    const due = await this.db
      .select({ id: reminders.id })
      .from(reminders)
      .where(and(eq(reminders.status, 'scheduled'), lt(reminders.fireAt, new Date(Date.now() - 2 * 60_000))))
      .limit(200);
    for (const r of due) await this.fire(r.id);
    return due.length;
  }
}

void inArray;
void lte;
