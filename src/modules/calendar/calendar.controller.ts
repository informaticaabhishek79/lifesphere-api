import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Actor, CurrentActor } from '../../common/auth-context';
import { CalendarService } from './calendar.service';

const KINDS = ['appointment', 'visit', 'errand', 'activity', 'other'] as const;
const VIS = ['private', 'household', 'shared'] as const;

class CreateCalendarEventDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) title: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @ApiPropertyOptional({ enum: KINDS }) @IsOptional() @IsIn(KINDS as unknown as string[]) kind?: (typeof KINDS)[number];
  @ApiProperty() @IsDateString() startsAt: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endsAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allDay?: boolean;
  @ApiPropertyOptional({ description: 'Place description (not a home address)' }) @IsOptional() @IsString() @MaxLength(200) locationText?: string;
  @ApiPropertyOptional({ example: 'FREQ=WEEKLY;BYDAY=SU' }) @IsOptional() @IsString() @MaxLength(300) recurrenceRule?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() householdId?: string;
  @ApiPropertyOptional({ enum: VIS }) @IsOptional() @IsIn(VIS as unknown as string[]) visibility?: (typeof VIS)[number];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsUUID('all', { each: true }) @ArrayMaxSize(30) attendeeUserIds?: string[];
  @ApiPropertyOptional({ description: 'For visits: the person being visited (must be a household member or trusted contact)' })
  @IsOptional()
  @IsUUID()
  visitForUserId?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(43200) reminderMinutesBefore?: number;
}

class UpdateCalendarEventDto extends PartialType(CreateCalendarEventDto) {}

class CalendarRangeQuery {
  @ApiProperty() @IsDateString() from: string;
  @ApiProperty() @IsDateString() to: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() householdId?: string;
  @ApiPropertyOptional({ description: 'View the shared calendar of someone who granted you calendar.view' }) @IsOptional() @IsUUID() ownerUserId?: string;
}

class CalendarRsvpDto {
  @ApiProperty({ enum: ['accepted', 'declined', 'tentative'] }) @IsIn(['accepted', 'declined', 'tentative']) status: 'accepted' | 'declined' | 'tentative';
}

class CalendarAttendeeDto {
  @ApiProperty() @IsUUID() userId: string;
}

@ApiTags('calendar')
@Controller({ path: 'calendar/events', version: '1' })
export class CalendarController {
  constructor(private readonly svc: CalendarService) {}

  @Get()
  list(@CurrentActor() actor: Actor, @Query() q: CalendarRangeQuery) {
    return this.svc.list(actor, q);
  }

  @Post()
  create(@CurrentActor() actor: Actor, @Body() dto: CreateCalendarEventDto) {
    return this.svc.create(actor, dto);
  }

  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.detail(actor, id);
  }

  @Patch(':id')
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCalendarEventDto) {
    return this.svc.update(actor, id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.cancel(actor, id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(actor, id);
  }

  @Post(':id/rsvp')
  @HttpCode(200)
  rsvp(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CalendarRsvpDto) {
    return this.svc.respond(actor, id, dto.status);
  }

  @Post(':id/attendees')
  addAttendee(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CalendarAttendeeDto) {
    return this.svc.addAttendee(actor, id, dto.userId);
  }

  @Delete(':id/attendees/:userId')
  @HttpCode(204)
  removeAttendee(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.svc.removeAttendee(actor, id, userId);
  }
}

void IsBoolean;
