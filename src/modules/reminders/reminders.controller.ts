import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { and, eq, isNull } from 'drizzle-orm';
import { Actor, CurrentActor } from '../../common/auth-context';
import { notFound } from '../../common/errors';
import { CursorQuery } from '../../common/pagination';
import { PolicyService } from '../../common/policy.service';
import { Database, DB } from '../../db/db';
import { calendarEvents, tasks } from '../../db/schema';
import { RemindersService } from './reminders.service';

const CHANNELS = ['in_app', 'push', 'email', 'sms'] as const;

export class CreateReminderDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) title: string;
  @ApiProperty({ example: '2026-10-20T09:00:00+05:30' }) @IsDateString() fireAt: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() taskId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() eventId?: string;
  @ApiPropertyOptional({ enum: CHANNELS, isArray: true }) @IsOptional() @IsIn(CHANNELS as unknown as string[], { each: true }) @ArrayMaxSize(4) channels?: (typeof CHANNELS)[number][];
}

class UpdateReminderDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() fireAt?: string;
  @ApiPropertyOptional({ enum: CHANNELS, isArray: true }) @IsOptional() @IsIn(CHANNELS as unknown as string[], { each: true }) @ArrayMaxSize(4) channels?: (typeof CHANNELS)[number][];
}

class ReminderListQuery extends CursorQuery {
  @ApiPropertyOptional({ enum: ['scheduled', 'sent', 'failed', 'cancelled'] }) @IsOptional() @IsIn(['scheduled', 'sent', 'failed', 'cancelled']) status?: string;
}

@ApiTags('reminders')
@Controller({ path: 'reminders', version: '1' })
export class RemindersController {
  constructor(
    private readonly svc: RemindersService,
    private readonly policy: PolicyService,
    @Inject(DB) private readonly db: Database,
  ) {}

  @Get()
  list(@CurrentActor() actor: Actor, @Query() q: ReminderListQuery) {
    return this.svc.list(actor, q);
  }

  @Post()
  async create(@CurrentActor() actor: Actor, @Body() dto: CreateReminderDto) {
    if (dto.taskId) {
      const [t] = await this.db.select().from(tasks).where(and(eq(tasks.id, dto.taskId), isNull(tasks.deletedAt)));
      if (!t || !(await this.policy.canViewTask(actor.userId, t))) throw notFound('Task');
    }
    if (dto.eventId) {
      const [e] = await this.db.select({ ownerUserId: calendarEvents.ownerUserId, householdId: calendarEvents.householdId }).from(calendarEvents).where(eq(calendarEvents.id, dto.eventId));
      const ok = e && (e.ownerUserId === actor.userId || (e.householdId && (await this.policy.householdRole(actor.userId, e.householdId))));
      if (!ok) throw notFound('Event');
    }
    return this.svc.create(actor.userId, { ...dto, fireAt: new Date(dto.fireAt) });
  }

  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(actor, id);
  }

  @Patch(':id')
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateReminderDto) {
    return this.svc.update(actor, id, { ...dto, fireAt: dto.fireAt ? new Date(dto.fireAt) : undefined });
  }

  @Delete(':id')
  @HttpCode(204)
  cancel(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.cancel(actor, id);
  }
}
