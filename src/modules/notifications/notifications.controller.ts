import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { Actor, CurrentActor, Public } from '../../common/auth-context';
import { CryptoService } from '../../common/crypto.service';
import { forbidden, notFound } from '../../common/errors';
import { CursorQuery, keyset, lim, pageOf } from '../../common/pagination';
import { PushAdapter } from '../../adapters/messaging';
import { Env, ENV } from '../../config/env';
import { Database, DB } from '../../db/db';
import { notificationDevices, notificationPreferences, notifications } from '../../db/schema';
import { CATEGORIES, Category, NotificationsService } from './notifications.service';

class RegisterDeviceDto {
  @ApiProperty({ enum: ['web', 'android', 'ios'] })
  @IsIn(['web', 'android', 'ios'])
  platform: 'web' | 'android' | 'ios';

  @ApiProperty({ description: 'FCM registration token, or the JSON-serialised Web Push subscription' })
  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  token: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) label?: string;
}

class NotificationPreferenceItemDto {
  @ApiProperty({ enum: CATEGORIES }) @IsIn(CATEGORIES) category: Category;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() inApp?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() push?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() email?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() sms?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() bypassQuietHours?: boolean;
}

class UpdateNotificationPreferencesDto {
  @ApiProperty({ type: [NotificationPreferenceItemDto] })
  @ValidateNested({ each: true })
  @Type(() => NotificationPreferenceItemDto)
  @ArrayMaxSize(20)
  items: NotificationPreferenceItemDto[];
}

class InboxQuery extends CursorQuery {
  @ApiPropertyOptional() @IsOptional() @IsIn(['true', 'false']) unreadOnly?: 'true' | 'false';
}

class MarkReadDto {
  @ApiPropertyOptional({ type: [String], description: 'Omit to mark all as read' })
  @IsOptional()
  @IsString({ each: true })
  @ArrayMaxSize(200)
  ids?: string[];
}

class DeliveryReportDto {
  @ApiProperty() @IsString() @MaxLength(120) providerMessageId: string;
  @ApiProperty() @IsBoolean() delivered: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

@ApiTags('notifications')
@Controller({ path: 'notifications', version: '1' })
export class NotificationsController {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly svc: NotificationsService,
    private readonly crypto: CryptoService,
    private readonly push: PushAdapter,
  ) {}

  @Get()
  async inbox(@CurrentActor() actor: Actor, @Query() q: InboxQuery) {
    const limit = lim(q);
    const rows = await this.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, actor.userId),
          q.unreadOnly === 'true' ? isNull(notifications.readAt) : undefined,
          keyset(notifications.createdAt, notifications.id, q.cursor),
        ),
      )
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(limit + 1);
    const page = pageOf(rows, limit, (r) => [r.createdAt, r.id]);
    return { ...page, unreadCount: await this.svc.unreadCount(actor.userId) };
  }

  @Post('read')
  @HttpCode(200)
  async markRead(@CurrentActor() actor: Actor, @Body() dto: MarkReadDto) {
    const res = await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.userId, actor.userId),
          isNull(notifications.readAt),
          dto.ids?.length ? inArray(notifications.id, dto.ids) : undefined,
        ),
      )
      .returning({ id: notifications.id });
    return { updated: res.length };
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    const res = await this.db
      .delete(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.userId, actor.userId)))
      .returning({ id: notifications.id });
    if (!res.length) throw notFound('Notification');
  }

  @Get('preferences')
  preferences(@CurrentActor() actor: Actor) {
    return this.svc.preferencesFor(actor.userId);
  }

  @Put('preferences')
  async updatePreferences(@CurrentActor() actor: Actor, @Body() dto: UpdateNotificationPreferencesDto) {
    const current = await this.svc.preferencesFor(actor.userId);
    for (const item of dto.items) {
      const base = current.find((c) => c.category === item.category)!;
      const next = {
        inApp: item.inApp ?? base.inApp,
        push: item.push ?? base.push,
        email: item.email ?? base.email,
        sms: item.sms ?? base.sms,
        bypassQuietHours: item.bypassQuietHours ?? base.bypassQuietHours,
      };
      // Security notices cannot be fully silenced.
      if (item.category === 'security' && !next.inApp && !next.email && !next.push) next.inApp = true;
      await this.db
        .insert(notificationPreferences)
        .values({ userId: actor.userId, category: item.category, ...next })
        .onConflictDoUpdate({ target: [notificationPreferences.userId, notificationPreferences.category], set: next });
    }
    return this.svc.preferencesFor(actor.userId);
  }

  @Get('devices')
  async devices(@CurrentActor() actor: Actor) {
    return this.db
      .select({
        id: notificationDevices.id,
        platform: notificationDevices.platform,
        label: notificationDevices.label,
        lastSeenAt: notificationDevices.lastSeenAt,
        createdAt: notificationDevices.createdAt,
      })
      .from(notificationDevices)
      .where(eq(notificationDevices.userId, actor.userId));
  }

  @Post('devices')
  async registerDevice(@CurrentActor() actor: Actor, @Body() dto: RegisterDeviceDto) {
    const tokenHash = this.crypto.sha256(dto.token);
    const [row] = await this.db
      .insert(notificationDevices)
      .values({ userId: actor.userId, sessionId: actor.sessionId, platform: dto.platform, token: dto.token, tokenHash, label: dto.label })
      .onConflictDoUpdate({
        target: notificationDevices.tokenHash,
        // A token re-registered by another account moves to that account (shared device sign-in).
        set: { userId: actor.userId, sessionId: actor.sessionId, label: dto.label, lastSeenAt: new Date() },
      })
      .returning({ id: notificationDevices.id, platform: notificationDevices.platform, label: notificationDevices.label });
    return row;
  }

  @Delete('devices/:id')
  @HttpCode(204)
  async removeDevice(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    const res = await this.db
      .delete(notificationDevices)
      .where(and(eq(notificationDevices.id, id), eq(notificationDevices.userId, actor.userId)))
      .returning({ id: notificationDevices.id });
    if (!res.length) throw notFound('Device');
  }

  @Public()
  @Get('webpush/public-key')
  vapidKey() {
    return { publicKey: this.push.vapidPublicKey };
  }

  /** Delivery reports from SMS/email providers. Authenticated with the shared webhook secret. */
  @Public()
  @Post('webhooks/:provider/delivery')
  @HttpCode(200)
  async deliveryReport(
    @Param('provider') provider: string,
    @Query('token') token: string,
    @Body() dto: DeliveryReportDto | DeliveryReportDto[],
  ) {
    if (!token || !this.crypto.safeEqualHex(this.crypto.sha256(token), this.crypto.sha256(this.env.WEBHOOK_SECRET))) {
      throw forbidden('Invalid webhook token', 'webhook_unauthorized');
    }
    if (!['msg91', 'resend'].includes(provider)) throw notFound('Provider');
    const reports = Array.isArray(dto) ? dto : [dto];
    let updated = 0;
    for (const r of reports.slice(0, 500)) {
      updated += await this.svc.applyDeliveryReport(provider, String(r.providerMessageId), !!r.delivered, r.reason);
    }
    return { updated };
  }
}
