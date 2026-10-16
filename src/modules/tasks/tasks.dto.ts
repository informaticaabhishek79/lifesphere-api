import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { CursorQuery } from '../../common/pagination';

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const VISIBILITIES = ['private', 'household', 'shared'] as const;
export const STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'] as const;

export class CreateTaskDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) title: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(5000) notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional({ enum: PRIORITIES }) @IsOptional() @IsIn(PRIORITIES as unknown as string[]) priority?: (typeof PRIORITIES)[number];
  @ApiPropertyOptional() @IsOptional() @IsDateString() dueAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allDay?: boolean;
  @ApiPropertyOptional({ example: 'FREQ=WEEKLY;BYDAY=MO,TH', description: 'RFC 5545 RRULE; requires dueAt' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  recurrenceRule?: string;
  @ApiPropertyOptional({ description: 'Create as a household task/chore' }) @IsOptional() @IsUUID() householdId?: string;
  @ApiPropertyOptional({ enum: VISIBILITIES, description: "'shared' lets contacts with a tasks.view grant see it" })
  @IsOptional()
  @IsIn(VISIBILITIES as unknown as string[])
  visibility?: (typeof VISIBILITIES)[number];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isChore?: boolean;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsUUID('all', { each: true }) @ArrayMaxSize(10) assigneeUserIds?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsUUID('all', { each: true }) @ArrayMaxSize(10) attachmentIds?: string[];
  @ApiPropertyOptional({ description: 'Create a reminder N minutes before dueAt' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60 * 24 * 30)
  reminderMinutesBefore?: number;
}

export class UpdateTaskDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(5000) notes?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() categoryId?: string | null;
  @ApiPropertyOptional({ enum: PRIORITIES }) @IsOptional() @IsIn(PRIORITIES as unknown as string[]) priority?: (typeof PRIORITIES)[number];
  @ApiPropertyOptional({ enum: STATUSES }) @IsOptional() @IsIn(['pending', 'in_progress', 'cancelled']) status?: 'pending' | 'in_progress' | 'cancelled';
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsDateString() dueAt?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() allDay?: boolean;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(300) recurrenceRule?: string | null;
  @ApiPropertyOptional({ enum: VISIBILITIES }) @IsOptional() @IsIn(VISIBILITIES as unknown as string[]) visibility?: (typeof VISIBILITIES)[number];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isChore?: boolean;
}

export class TaskQuery extends CursorQuery {
  @ApiPropertyOptional({ enum: ['mine', 'household', 'assigned', 'shared', 'all'], default: 'all' })
  @IsOptional()
  @IsIn(['mine', 'household', 'assigned', 'shared', 'all'])
  scope?: 'mine' | 'household' | 'assigned' | 'shared' | 'all';
  @ApiPropertyOptional() @IsOptional() @IsUUID() householdId?: string;
  @ApiPropertyOptional({ description: 'For scope=shared: tasks of this person who granted tasks.view' }) @IsOptional() @IsUUID() ownerUserId?: string;
  @ApiPropertyOptional({ enum: [...STATUSES, 'open', 'overdue'] }) @IsOptional() @IsIn([...STATUSES, 'open', 'overdue']) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() categoryId?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dueFrom?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dueTo?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['true', 'false']) choresOnly?: 'true' | 'false';
  @ApiPropertyOptional({ enum: ['created', 'updated'], default: 'created' }) @IsOptional() @IsIn(['created', 'updated']) sort?: 'created' | 'updated';
}

export class TaskAssignDto {
  @ApiProperty() @IsUUID() userId: string;
}

export class AttachmentLinkDto {
  @ApiProperty() @IsUUID() attachmentId: string;
}

export class TaskCategoryDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(40) name: string;
  @ApiPropertyOptional({ example: '#4F7CAC' }) @IsOptional() @Matches(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/) color?: string;
  @ApiPropertyOptional({ description: 'Household category instead of personal' }) @IsOptional() @IsUUID() householdId?: string;
}

export class UpdateTaskCategoryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(40) name?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/) color?: string;
}
