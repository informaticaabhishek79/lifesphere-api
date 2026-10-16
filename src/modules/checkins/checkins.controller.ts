import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Actor, CurrentActor } from '../../common/auth-context';
import { CheckinsService } from './checkins.service';

const KINDS = ['daily', 'weekly', 'one_off', 'visit_confirmation', 'assistance_confirmation'] as const;

class CheckInScheduleDto {
  @ApiProperty({ example: 'Morning check-in' }) @IsString() @MinLength(1) @MaxLength(80) label: string;
  @ApiProperty({ enum: KINDS }) @IsIn(KINDS as unknown as string[]) kind: (typeof KINDS)[number];
  @ApiPropertyOptional({ example: '09:00' }) @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) timeLocal?: string;
  @ApiPropertyOptional({ example: [1, 3, 5], description: '0=Sunday … 6=Saturday (weekly)' })
  @IsOptional()
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  @ArrayMaxSize(7)
  daysOfWeek?: number[];
  @ApiPropertyOptional({ description: 'For one-off, visit or assistance confirmations' }) @IsOptional() @IsDateString() oneOffAt?: string;
  @ApiPropertyOptional({ example: 'Asia/Kolkata' }) @IsOptional() @IsString() @MaxLength(60) timezone?: string;
  @ApiPropertyOptional({ default: 15 }) @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(240) reminderAfterMinutes?: number;
  @ApiPropertyOptional({ default: 30 }) @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(720) graceMinutes?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() escalate?: boolean;
  @ApiPropertyOptional({ type: [String], description: 'Contacts holding a checkins.alerts grant from you' })
  @IsOptional()
  @IsUUID('all', { each: true })
  @ArrayMaxSize(5)
  escalationContactIds?: string[];
  @ApiPropertyOptional({ description: 'Required the first time you turn on contact alerts' }) @IsOptional() @IsBoolean() consentToAlertContacts?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

class UpdateCheckInScheduleDto extends PartialType(CheckInScheduleDto) {}

class CheckInEventsQuery {
  @ApiPropertyOptional({ description: 'Someone who shares check-ins with you' }) @IsOptional() @IsUUID() userId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
}

class CheckInNoteDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) note?: string;
}

@ApiTags('check-ins')
@Controller({ path: 'check-ins', version: '1' })
export class CheckinsController {
  constructor(private readonly svc: CheckinsService) {}

  @Get('schedules')
  schedules(@CurrentActor() actor: Actor) {
    return this.svc.schedules(actor);
  }

  @Post('schedules')
  create(@CurrentActor() actor: Actor, @Body() dto: CheckInScheduleDto) {
    return this.svc.create(actor, dto);
  }

  @Patch('schedules/:id')
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCheckInScheduleDto) {
    return this.svc.update(actor, id, dto);
  }

  @Delete('schedules/:id')
  @HttpCode(204)
  remove(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(actor, id);
  }

  /** Big "I'm OK" button: completes the current open check-in. */
  @Post('now')
  @HttpCode(200)
  now(@CurrentActor() actor: Actor, @Body() dto: CheckInNoteDto) {
    return this.svc.complete(actor, undefined, dto.note);
  }

  @Get('events')
  events(@CurrentActor() actor: Actor, @Query() q: CheckInEventsQuery) {
    return this.svc.events(actor, q);
  }

  @Get('people')
  people(@CurrentActor() actor: Actor) {
    return this.svc.people(actor);
  }

  @Get('events/:id')
  event(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.event(actor, id);
  }

  @Post('events/:id/complete')
  @HttpCode(200)
  complete(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CheckInNoteDto) {
    return this.svc.complete(actor, id, dto.note);
  }

  @Post('events/:id/acknowledge')
  @HttpCode(200)
  acknowledge(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CheckInNoteDto) {
    return this.svc.acknowledge(actor, id, dto.note);
  }
}
