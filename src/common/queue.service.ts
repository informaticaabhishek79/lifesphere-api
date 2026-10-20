import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import PgBoss from 'pg-boss';
import { Env, ENV } from '../config/env';
import { normalizeDbUrl } from '../db/db';

export const JOBS = {
  notificationDeliver: 'notification.deliver',
  reminderFire: 'reminder.fire',
  checkinTick: 'checkin.tick',
  grantsActivate: 'grants.activate',
  privacyExport: 'privacy.export',
  privacyDeletionSweep: 'privacy.deletion-sweep',
  retentionPurge: 'retention.purge',
  knowledgeIngest: 'knowledge.ingest',
  householdDailyTick: 'household.daily-tick',
  heartbeat: 'worker.heartbeat',
  inboxProcess: 'inbox.process',
  inboxScan: 'inbox.scan',
} as const;

export type JobName = (typeof JOBS)[keyof typeof JOBS];

export interface SendOptions {
  startAfter?: Date;
  singletonKey?: string;
  retryLimit?: number;
  retryDelay?: number;
  retryBackoff?: boolean;
}

/**
 * Postgres-backed job queue (pg-boss). Uses the direct (non-pooled) database URL.
 * The API process only enqueues; the worker process consumes and runs schedules.
 */
@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Queue');
  readonly boss: PgBoss;
  private started = false;

  constructor(@Inject(ENV) private readonly env: Env) {
    const isWorker = env.PROCESS_ROLE !== 'api';
    this.boss = new PgBoss({
      connectionString: normalizeDbUrl(env.DATABASE_DIRECT_URL ?? env.DATABASE_URL),
      ssl: env.DATABASE_SSL ? { rejectUnauthorized: true } : undefined,
      max: isWorker ? 5 : 2,
      supervise: isWorker,
      schedule: isWorker,
      application_name: `lifesphere-queue-${env.PROCESS_ROLE}`,
    });
    this.boss.on('error', (err: Error) => this.logger.error(`pg-boss: ${err.message}`));
  }

  async onModuleInit() {
    await this.boss.start();
    for (const name of Object.values(JOBS)) {
      try {
        await this.boss.createQueue(name);
      } catch {
        /* queue exists */
      }
    }
    this.started = true;
  }

  async onModuleDestroy() {
    if (this.started) await this.boss.stop({ graceful: true, timeout: 10_000 });
  }

  async send(name: JobName, data: object, opts: SendOptions = {}): Promise<string | null> {
    return this.boss.send(name, data, {
      retryLimit: opts.retryLimit ?? 5,
      retryDelay: opts.retryDelay ?? 30,
      retryBackoff: opts.retryBackoff ?? true,
      startAfter: opts.startAfter,
      singletonKey: opts.singletonKey,
    });
  }

  async cancel(name: JobName, id: string) {
    try {
      await this.boss.cancel(name, id);
    } catch {
      /* already done */
    }
  }

  async healthy(): Promise<boolean> {
    try {
      await this.boss.getQueueSize(JOBS.heartbeat);
      return true;
    } catch {
      return false;
    }
  }
}
