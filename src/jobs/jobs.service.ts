import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { and, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import { StorageAdapter } from '../adapters/storage';
import { JOBS, QueueService } from '../common/queue.service';
import { addDays } from '../common/time';
import { Env, ENV } from '../config/env';
import { Database, DB } from '../db/db';
import {
  alertDeliveries,
  attachments,
  auditEvents,
  checkInEvents,
  consumerCases,
  contactInvitations,
  groupInvitations,
  homeInventoryItems,
  householdInvitations,
  idempotencyKeys,
  notificationJobs,
  notifications,
  otpChallenges,
  purchases,
  reminders,
  sessions,
  tasks,
} from '../db/schema';
import { AdminService } from '../modules/admin/admin.service';
import { CheckinsService } from '../modules/checkins/checkins.service';
import { ConsumerService } from '../modules/consumer/consumer.service';
import { ContactsService } from '../modules/contacts/contacts.service';
import { HelpService } from '../modules/help/help.service';
import { HouseholdToolsService } from '../modules/household-tools/household-tools.service';
import { KnowledgeService } from '../modules/knowledge/knowledge.service';
import { ModerationService } from '../modules/moderation/moderation.service';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { PrivacyService } from '../modules/privacy/privacy.service';
import { RemindersService } from '../modules/reminders/reminders.service';

const TZ = 'Asia/Kolkata';

/**
 * Registers job handlers and schedules in the worker process (PROCESS_ROLE=worker or both).
 * Each handler is idempotent so retries and overlapping runs are safe.
 */
@Injectable()
export class JobsService implements OnApplicationBootstrap {
  private readonly logger = new Logger('Jobs');

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly queue: QueueService,
    private readonly storage: StorageAdapter,
    private readonly notifications: NotificationsService,
    private readonly reminders: RemindersService,
    private readonly checkins: CheckinsService,
    private readonly contacts: ContactsService,
    private readonly privacy: PrivacyService,
    private readonly help: HelpService,
    private readonly householdTools: HouseholdToolsService,
    private readonly consumer: ConsumerService,
    private readonly knowledge: KnowledgeService,
    private readonly moderation: ModerationService,
    private readonly admin: AdminService,
  ) {}

  async onApplicationBootstrap() {
    if (this.env.PROCESS_ROLE === 'api') return;
    const boss = this.queue.boss;
    const work = <T>(name: string, fn: (data: T) => Promise<unknown>, opts: { batchSize?: number; pollingIntervalSeconds?: number } = {}) =>
      boss.work<T>(name, { batchSize: opts.batchSize ?? 1, pollingIntervalSeconds: opts.pollingIntervalSeconds ?? 2 }, async (jobs) => {
        for (const job of jobs) await fn(job.data);
      });

    await work<Parameters<NotificationsService['deliver']>[0]>(JOBS.notificationDeliver, (d) => this.notifications.deliver(d), { batchSize: 5, pollingIntervalSeconds: 1 });
    await work<{ reminderId: string }>(JOBS.reminderFire, (d) => this.reminders.fire(d.reminderId), { pollingIntervalSeconds: 1 });
    await work<{ requestId: string }>(JOBS.privacyExport, (d) => this.privacy.runExport(d.requestId));
    await work<{ articleId: string }>(JOBS.knowledgeIngest, (d) => this.knowledge.ingest(d.articleId));
    await work(JOBS.checkinTick, () => this.minuteTick());
    await work(JOBS.grantsActivate, () => this.contacts.activateDueGrants());
    await work(JOBS.heartbeat, () => this.heartbeat());
    await work(JOBS.retentionPurge, () => this.retentionPurge());
    await work(JOBS.privacyDeletionSweep, () => this.privacy.runDeletionSweep());
    await work(JOBS.householdDailyTick, () => this.dailyTick());

    await boss.schedule(JOBS.checkinTick, '* * * * *', {}, { tz: TZ, singletonKey: 'checkin-tick' });
    await boss.schedule(JOBS.grantsActivate, '* * * * *', {}, { tz: TZ });
    await boss.schedule(JOBS.heartbeat, '* * * * *', {}, { tz: TZ });
    await boss.schedule(JOBS.retentionPurge, '30 2 * * *', {}, { tz: TZ });
    await boss.schedule(JOBS.privacyDeletionSweep, '0 3 * * *', {}, { tz: TZ });
    await boss.schedule(JOBS.householdDailyTick, '0 8 * * *', {}, { tz: TZ });
    this.logger.log('Worker handlers and schedules registered');
  }

  /** Every minute: check-in engine and reminder safety net. */
  async minuteTick() {
    const c = await this.checkins.tick();
    const r = await this.reminders.sweepOverdue();
    if (c.created || c.reminded || c.escalated || r) this.logger.log(`tick: checkins=${JSON.stringify(c)} overdueReminders=${r}`);
    return { ...c, overdueReminders: r };
  }

  async heartbeat() {
    if (!this.env.WORKER_HEARTBEAT_URL) return;
    await fetch(this.env.WORKER_HEARTBEAT_URL, { method: 'GET', signal: AbortSignal.timeout(5000) }).catch(() => undefined);
  }

  /** Daily 08:00 IST: maintenance, warranties, case follow-ups, verification expiry, monthly sharing summary. */
  async dailyTick() {
    const maintenance = await this.householdTools.maintenanceTick();
    const consumer = await this.consumer.dailyReminders();
    const verifications = await this.admin.expireVerifications();
    let sharingSummaries = 0;
    if (new Date().getDate() === 1) sharingSummaries = await this.contacts.monthlySharingSummary();
    return { maintenance, consumer, verifications, sharingSummaries };
  }

  /** Daily 02:30 IST: enforce the documented retention periods. */
  async retentionPurge() {
    const now = new Date();
    const out: Record<string, number> = {};
    const count = async (key: string, p: Promise<unknown[]>) => {
      out[key] = (await p).length;
    };

    await count('otpChallenges', this.db.delete(otpChallenges).where(lt(otpChallenges.expiresAt, addDays(now, -1))).returning({ id: otpChallenges.id }));
    await count('idempotencyKeys', this.db.delete(idempotencyKeys).where(lt(idempotencyKeys.expiresAt, now)).returning({ id: idempotencyKeys.id }));
    await count(
      'sessions',
      this.db
        .delete(sessions)
        .where(sql`(${sessions.revokedAt} is not null and ${sessions.revokedAt} < ${addDays(now, -30)}) or ${sessions.expiresAt} < ${addDays(now, -30)}`)
        .returning({ id: sessions.id }),
    );

    // Temporary attachments: storage object first, then the row.
    const temp = await this.db
      .select({ id: attachments.id, key: attachments.storageKey })
      .from(attachments)
      .where(and(eq(attachments.temporary, true), lt(attachments.expiresAt, now)))
      .limit(1000);
    for (const t of temp) {
      await this.storage.delete(t.key).catch(() => undefined);
      await this.db.delete(attachments).where(eq(attachments.id, t.id));
    }
    out.temporaryAttachments = temp.length;

    const softCutoff = addDays(now, -this.env.SOFT_DELETE_PURGE_DAYS);
    await count('tasks', this.db.delete(tasks).where(and(isNotNull(tasks.deletedAt), lt(tasks.deletedAt, softCutoff))).returning({ id: tasks.id }));
    await count('inventory', this.db.delete(homeInventoryItems).where(and(isNotNull(homeInventoryItems.deletedAt), lt(homeInventoryItems.deletedAt, softCutoff))).returning({ id: homeInventoryItems.id }));
    await count('purchases', this.db.delete(purchases).where(and(isNotNull(purchases.deletedAt), lt(purchases.deletedAt, softCutoff))).returning({ id: purchases.id }));
    await count('consumerCases', this.db.delete(consumerCases).where(and(isNotNull(consumerCases.deletedAt), lt(consumerCases.deletedAt, softCutoff))).returning({ id: consumerCases.id }));

    await count('checkInEvents', this.db.delete(checkInEvents).where(lt(checkInEvents.dueAt, addDays(now, -90))).returning({ id: checkInEvents.id }));
    await count('alertDeliveries', this.db.delete(alertDeliveries).where(lt(alertDeliveries.createdAt, addDays(now, -90))).returning({ id: alertDeliveries.id }));
    await count('reminders', this.db.delete(reminders).where(and(inArray(reminders.status, ['sent', 'cancelled', 'failed']), lt(reminders.fireAt, addDays(now, -90)))).returning({ id: reminders.id }));
    await count('notifications', this.db.delete(notifications).where(lt(notifications.createdAt, addDays(now, -180))).returning({ id: notifications.id }));
    await count('notificationJobs', this.db.delete(notificationJobs).where(lt(notificationJobs.createdAt, addDays(now, -90))).returning({ id: notificationJobs.id }));
    await count('auditEvents', this.db.delete(auditEvents).where(lt(auditEvents.createdAt, addDays(now, -this.env.AUDIT_RETENTION_DAYS))).returning({ id: auditEvents.id }));

    for (const [key, table] of [
      ['householdInvitations', householdInvitations],
      ['contactInvitations', contactInvitations],
      ['groupInvitations', groupInvitations],
    ] as const) {
      await count(key, this.db.update(table).set({ status: 'expired' }).where(and(eq(table.status, 'pending'), lt(table.expiresAt, now))).returning({ id: table.id }));
    }

    out.helpLocations = await this.help.purgeLocations();
    out.evidenceSnapshots = await this.moderation.purgeEvidence();
    out.aiConversations = await this.knowledge.purgeConversations();
    await this.db.execute(
      sql`update community_groups g set member_count = coalesce((select count(*) from group_memberships m where m.group_id = g.id and m.status = 'active'), 0)`,
    );
    this.logger.log(`retention purge: ${JSON.stringify(out)}`);
    return out;
  }
}
