import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { EmailAdapter, PushAdapter, SmsAdapter } from '../../adapters/messaging';
import { Database, DB, DbOrTx } from '../../db/db';
import {
  notificationDevices,
  notificationJobs,
  notificationPreferences,
  notifications,
  userPreferences,
  userProfiles,
  users,
} from '../../db/schema';
import { JOBS, QueueService } from '../../common/queue.service';
import { quietHoursEnd } from '../../common/time';

export type Category =
  | 'reminders'
  | 'tasks'
  | 'household'
  | 'family'
  | 'checkins'
  | 'help'
  | 'community'
  | 'services'
  | 'consumer'
  | 'security'
  | 'privacy'
  | 'system';

export type Channel = 'in_app' | 'push' | 'sms' | 'email';

export const CATEGORIES: Category[] = [
  'reminders',
  'tasks',
  'household',
  'family',
  'checkins',
  'help',
  'community',
  'services',
  'consumer',
  'security',
  'privacy',
  'system',
];

/** Defaults when the user has not saved a preference for a category. */
const DEFAULT_PREFS: Record<Category, { inApp: boolean; push: boolean; email: boolean; sms: boolean; bypassQuietHours: boolean }> = {
  reminders: { inApp: true, push: true, email: false, sms: false, bypassQuietHours: false },
  tasks: { inApp: true, push: true, email: false, sms: false, bypassQuietHours: false },
  household: { inApp: true, push: true, email: false, sms: false, bypassQuietHours: false },
  family: { inApp: true, push: true, email: false, sms: false, bypassQuietHours: false },
  checkins: { inApp: true, push: true, email: false, sms: true, bypassQuietHours: true },
  help: { inApp: true, push: true, email: false, sms: true, bypassQuietHours: true },
  community: { inApp: true, push: false, email: false, sms: false, bypassQuietHours: false },
  services: { inApp: true, push: true, email: false, sms: false, bypassQuietHours: false },
  consumer: { inApp: true, push: true, email: false, sms: false, bypassQuietHours: false },
  security: { inApp: true, push: true, email: true, sms: false, bypassQuietHours: true },
  privacy: { inApp: true, push: false, email: true, sms: false, bypassQuietHours: false },
  system: { inApp: true, push: false, email: false, sms: false, bypassQuietHours: false },
};

/** Lock-screen safe titles used unless the user chose "full" detail. */
const GENERIC_TITLES: Record<Category, string> = {
  reminders: 'Reminder',
  tasks: 'Task update',
  household: 'Household update',
  family: 'Family update',
  checkins: 'Check-in',
  help: 'Help request',
  community: 'Community update',
  services: 'Service update',
  consumer: 'Case update',
  security: 'Security notice',
  privacy: 'Privacy request update',
  system: 'LifeSphere',
};

export interface NotifyInput {
  userId: string;
  category: Category;
  template: string;
  /** Full title; shown in-app, and on the lock screen only if the user chose full detail. */
  title: string;
  body?: string;
  /** Deep-link data, ids only. */
  data?: Record<string, string>;
  /** Channels to attempt in addition to in-app. Each still respects the user's preferences. */
  channels?: Exclude<Channel, 'in_app'>[];
  /** Safety-critical alerts (help, missed check-in escalation): bypass quiet hours and use SMS if enabled. */
  critical?: boolean;
  related?: { type: string; id: string };
  /** Short SMS text (DLT template variable). Defaults to a generic prompt to open the app. */
  smsText?: string;
  emailSubject?: string;
  emailText?: string;
}

export interface NotifyResult {
  inboxId: string | null;
  jobs: { id: string; channel: Channel; status: string }[];
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notifications');

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly queue: QueueService,
    private readonly sms: SmsAdapter,
    private readonly email: EmailAdapter,
    private readonly push: PushAdapter,
  ) {}

  async preferencesFor(userId: string) {
    const rows = await this.db.select().from(notificationPreferences).where(eq(notificationPreferences.userId, userId));
    return CATEGORIES.map((c) => {
      const r = rows.find((x) => x.category === c);
      const d = DEFAULT_PREFS[c];
      return {
        category: c,
        inApp: r?.inApp ?? d.inApp,
        push: r?.push ?? d.push,
        email: r?.email ?? d.email,
        sms: r?.sms ?? d.sms,
        bypassQuietHours: r?.bypassQuietHours ?? d.bypassQuietHours,
      };
    });
  }

  /**
   * Record an in-app notification and queue external deliveries. Never claims delivery:
   * job status moves to sent/delivered only when a provider confirms.
   */
  async notify(input: NotifyInput, tx: DbOrTx = this.db): Promise<NotifyResult> {
    const prefs = (await this.preferencesFor(input.userId)).find((p) => p.category === input.category)!;
    const [ctx] = await tx
      .select({
        status: users.status,
        phone: users.phoneE164,
        phoneVerified: users.phoneVerifiedAt,
        email: users.email,
        emailVerified: users.emailVerifiedAt,
        tz: userProfiles.timezone,
        quietStart: userPreferences.quietHoursStart,
        quietEnd: userPreferences.quietHoursEnd,
        lockScreen: userPreferences.lockScreenDetail,
      })
      .from(users)
      .leftJoin(userProfiles, eq(userProfiles.userId, users.id))
      .leftJoin(userPreferences, eq(userPreferences.userId, users.id))
      .where(eq(users.id, input.userId))
      .limit(1);
    const result: NotifyResult = { inboxId: null, jobs: [] };
    if (!ctx || ctx.status === 'deleted' || ctx.status === 'disabled') return result;

    if (prefs.inApp || input.critical) {
      const [row] = await tx
        .insert(notifications)
        .values({
          userId: input.userId,
          category: input.category,
          title: input.title.slice(0, 160),
          body: input.body?.slice(0, 500),
          data: input.data ?? {},
        })
        .returning({ id: notifications.id });
      result.inboxId = row.id;
    }

    const quietEnd =
      input.critical || prefs.bypassQuietHours ? null : quietHoursEnd(new Date(), ctx.quietStart, ctx.quietEnd, ctx.tz ?? 'UTC');

    const wanted = new Set(input.channels ?? ['push']);
    const channels: Exclude<Channel, 'in_app'>[] = [];
    if (wanted.has('push') && prefs.push) channels.push('push');
    if (wanted.has('sms') && prefs.sms && ctx.phone && ctx.phoneVerified) channels.push('sms');
    if (wanted.has('email') && prefs.email && ctx.email && ctx.emailVerified) channels.push('email');

    const lock = ctx.lockScreen ?? 'generic';
    const pushTitle = lock === 'full' ? input.title : lock === 'generic' ? GENERIC_TITLES[input.category] : 'LifeSphere';
    const pushBody = lock === 'full' ? (input.body ?? '') : 'Open LifeSphere to see details';

    for (const channel of channels) {
      const [job] = await tx
        .insert(notificationJobs)
        .values({
          userId: input.userId,
          category: input.category,
          channel,
          template: input.template,
          status: 'queued',
          scheduledFor: quietEnd ?? new Date(),
          relatedType: input.related?.type,
          relatedId: input.related?.id,
        })
        .returning({ id: notificationJobs.id });
      result.jobs.push({ id: job.id, channel, status: 'queued' });
      await this.queue.send(
        JOBS.notificationDeliver,
        {
          jobId: job.id,
          title: pushTitle,
          body: pushBody,
          data: input.data ?? {},
          critical: !!input.critical,
          smsText: (input.smsText ?? `${GENERIC_TITLES[input.category]}: please open LifeSphere`).slice(0, 120),
          emailSubject: input.emailSubject ?? GENERIC_TITLES[input.category],
          emailText: input.emailText ?? `${input.title}\n\n${input.body ?? ''}\n\nOpen LifeSphere to see details.`,
        },
        { startAfter: quietEnd ?? undefined, retryLimit: input.critical ? 8 : 4, retryDelay: input.critical ? 15 : 60 },
      );
    }
    return result;
  }

  /** Worker: perform one queued delivery. Throws on transient failure so the queue retries. */
  async deliver(data: {
    jobId: string;
    title: string;
    body: string;
    data: Record<string, string>;
    critical: boolean;
    smsText: string;
    emailSubject: string;
    emailText: string;
  }) {
    const [job] = await this.db.select().from(notificationJobs).where(eq(notificationJobs.id, data.jobId)).limit(1);
    if (!job || !job.userId || ['sent', 'delivered', 'simulated', 'suppressed'].includes(job.status)) return;
    const [user] = await this.db
      .select({ status: users.status, phone: users.phoneE164, email: users.email })
      .from(users)
      .where(eq(users.id, job.userId))
      .limit(1);
    if (!user || user.status === 'deleted' || user.status === 'disabled') {
      await this.mark(job.id, { status: 'suppressed', lastError: 'recipient unavailable' });
      return;
    }
    await this.db
      .update(notificationJobs)
      .set({ status: 'sending', attempts: sql`${notificationJobs.attempts} + 1` })
      .where(eq(notificationJobs.id, job.id));

    let outcome: { status: 'sent' | 'simulated' | 'failed'; provider: string; providerMessageId?: string; error?: string; permanent?: boolean };

    if (job.channel === 'push') {
      const devices = await this.db.select().from(notificationDevices).where(eq(notificationDevices.userId, job.userId));
      if (!devices.length) {
        await this.mark(job.id, { status: 'suppressed', lastError: 'no registered devices' });
        return;
      }
      const results = await Promise.all(
        devices.map(async (d) => {
          const r = await this.push.send(d.platform, d.token, { title: data.title, body: data.body, data: data.data, critical: data.critical });
          if (r.status === 'failed' && r.permanent) await this.db.delete(notificationDevices).where(eq(notificationDevices.id, d.id));
          return r;
        }),
      );
      const ok = results.find((r) => r.status === 'sent') ?? results.find((r) => r.status === 'simulated');
      const failed = results.find((r) => r.status === 'failed') as { error?: string; permanent?: boolean } | undefined;
      outcome = ok
        ? { status: ok.status as 'sent' | 'simulated', provider: ok.provider, providerMessageId: 'providerMessageId' in ok ? ok.providerMessageId : undefined }
        : { status: 'failed', provider: 'push', error: failed?.error ?? 'push failed', permanent: results.every((r) => r.status === 'failed' && r.permanent) };
    } else if (job.channel === 'sms') {
      if (!user.phone) return this.mark(job.id, { status: 'suppressed', lastError: 'no phone' });
      const r = await this.sms.send(user.phone, 'alert', { var1: data.smsText });
      outcome = r.status === 'failed' ? { status: 'failed', provider: r.provider, error: r.error, permanent: r.permanent } : r;
    } else if (job.channel === 'email') {
      if (!user.email) return this.mark(job.id, { status: 'suppressed', lastError: 'no email' });
      const r = await this.email.send(user.email, data.emailSubject, data.emailText);
      outcome = r.status === 'failed' ? { status: 'failed', provider: r.provider, error: r.error, permanent: r.permanent } : r;
    } else {
      return;
    }

    if (outcome.status === 'failed') {
      await this.mark(job.id, { status: 'failed', provider: outcome.provider, lastError: outcome.error?.slice(0, 300) });
      if (!outcome.permanent) throw new Error(`Delivery failed (will retry): ${outcome.error}`);
      return;
    }
    await this.mark(job.id, {
      status: outcome.status,
      provider: outcome.provider,
      providerMessageId: outcome.providerMessageId,
      sentAt: new Date(),
      lastError: null,
    });
  }

  private async mark(id: string, patch: Partial<typeof notificationJobs.$inferInsert>) {
    await this.db.update(notificationJobs).set(patch).where(eq(notificationJobs.id, id));
  }

  /** Provider delivery report (e.g. MSG91 webhook). Only a provider can move a job to 'delivered'. */
  async applyDeliveryReport(provider: string, providerMessageId: string, delivered: boolean, reason?: string) {
    const res = await this.db
      .update(notificationJobs)
      .set(
        delivered
          ? { status: 'delivered', deliveredAt: new Date() }
          : { status: 'failed', lastError: (reason ?? 'provider reported failure').slice(0, 300) },
      )
      .where(and(eq(notificationJobs.provider, provider), eq(notificationJobs.providerMessageId, providerMessageId)))
      .returning({ id: notificationJobs.id });
    return res.length;
  }

  async jobsFor(relatedType: string, relatedIds: string[]) {
    if (!relatedIds.length) return [];
    return this.db
      .select({
        id: notificationJobs.id,
        userId: notificationJobs.userId,
        channel: notificationJobs.channel,
        status: notificationJobs.status,
        sentAt: notificationJobs.sentAt,
        deliveredAt: notificationJobs.deliveredAt,
        relatedId: notificationJobs.relatedId,
      })
      .from(notificationJobs)
      .where(and(eq(notificationJobs.relatedType, relatedType), inArray(notificationJobs.relatedId, relatedIds)))
      .orderBy(desc(notificationJobs.createdAt));
  }

  async unreadCount(userId: string) {
    const [r] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return r?.n ?? 0;
  }
}
