import { Controller, Get, HttpException, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { sql } from 'drizzle-orm';
import { Public } from '../../common/auth-context';
import { QueueService } from '../../common/queue.service';
import { Env, ENV } from '../../config/env';
import { Database, DB } from '../../db/db';

@ApiTags('health')
@SkipThrottle()
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly queue: QueueService,
  ) {}

  @Public()
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /** Readiness: database and job queue reachable. Also reports which integrations are simulated. */
  @Public()
  @Get('ready')
  async ready() {
    let db = false;
    try {
      await this.db.execute(sql`select 1`);
      db = true;
    } catch {
      db = false;
    }
    const queue = await this.queue.healthy();
    const body = {
      status: db && queue ? 'ok' : 'degraded',
      checks: { database: db, queue },
      integrations: {
        sms: this.env.SMS_PROVIDER === 'mock' ? 'simulated' : this.env.SMS_PROVIDER,
        email: this.env.EMAIL_PROVIDER === 'mock' ? 'simulated' : this.env.EMAIL_PROVIDER,
        push: this.env.PUSH_PROVIDER === 'mock' ? 'simulated' : this.env.PUSH_PROVIDER,
        webPush: this.env.WEBPUSH_VAPID_PUBLIC_KEY ? 'configured' : 'simulated',
        storage: this.env.STORAGE_PROVIDER,
        ai: this.env.AI_PROVIDER === 'mock' ? 'simulated' : this.env.AI_PROVIDER,
        embeddings: this.env.EMBEDDINGS_PROVIDER === 'none' ? 'disabled (full-text search only)' : this.env.EMBEDDINGS_PROVIDER,
      },
    };
    if (!db || !queue) throw new HttpException(body, 503);
    return body;
  }
}
