import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export const FEATURE_KEYS = ['lifeos', 'household', 'familycare', 'community', 'consumer', 'services', 'assistant'] as const;
export const WIDGET_KEYS = [
  'today_tasks',
  'upcoming_reminders',
  'check_ins',
  'family_activity',
  'household',
  'service_requests',
  'community_updates',
  'consumer_cases',
  'quick_actions',
] as const;

export class UpdateProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(80) displayName?: string;
  @ApiPropertyOptional({ example: 'en-GB' }) @IsOptional() @IsString() @Matches(/^[a-z]{2}(-[A-Z]{2})?$/) locale?: string;
  @ApiPropertyOptional({ example: 'Europe/London' }) @IsOptional() @IsString() @MaxLength(60) timezone?: string;
  @ApiPropertyOptional({ example: 'GB', description: 'Country of residence (ISO 3166 alpha-2)' }) @IsOptional() @Matches(/^[A-Z]{2}$/) country?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() seniorMode?: boolean;
  @ApiPropertyOptional({ description: 'Appear in community member lists and search' }) @IsOptional() @IsBoolean() discoverable?: boolean;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() localityId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(280) bio?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() avatarAttachmentId?: string | null;
}

export class AccessibilityDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 2 }) @IsOptional() @IsNumber() @Min(1) @Max(2) textScale?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() highContrast?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() reduceMotion?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() voiceNavigation?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() screenReaderHints?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() simpleConfirmations?: boolean;
}

export class WidgetDto {
  @ApiPropertyOptional({ enum: WIDGET_KEYS }) @IsIn(WIDGET_KEYS as unknown as string[]) key: string;
  @ApiPropertyOptional() @IsBoolean() enabled: boolean;
  @ApiPropertyOptional() @IsInt() @Min(0) @Max(50) order: number;
}

export class UpdatePreferencesDto {
  @ApiPropertyOptional({ enum: ['system', 'light', 'dark', 'high_contrast'] })
  @IsOptional()
  @IsIn(['system', 'light', 'dark', 'high_contrast'])
  theme?: 'system' | 'light' | 'dark' | 'high_contrast';

  @ApiPropertyOptional({ type: AccessibilityDto }) @IsOptional() @ValidateNested() @Type(() => AccessibilityDto) accessibility?: AccessibilityDto;

  @ApiPropertyOptional({ type: [WidgetDto] })
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => WidgetDto)
  @ArrayMaxSize(20)
  dashboardWidgets?: WidgetDto[];

  @ApiPropertyOptional({ enum: FEATURE_KEYS, isArray: true })
  @IsOptional()
  @IsIn(FEATURE_KEYS as unknown as string[], { each: true })
  @ArrayMaxSize(10)
  disabledFeatures?: string[];

  @ApiPropertyOptional({ enum: ['none', 'generic', 'full'], description: 'How much detail push notifications show on the lock screen' })
  @IsOptional()
  @IsIn(['none', 'generic', 'full'])
  lockScreenDetail?: 'none' | 'generic' | 'full';

  @ApiPropertyOptional({ example: '22:00', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  quietHoursStart?: string | null;

  @ApiPropertyOptional({ example: '07:00', nullable: true })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  quietHoursEnd?: string | null;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() aiEnabled?: boolean;
  @ApiPropertyOptional({ description: 'Keep assistant conversations (30 days) instead of discarding after each answer' })
  @IsOptional()
  @IsBoolean()
  aiStoreHistory?: boolean;
}

export class LocalityQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) search?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) city?: string;
  @ApiPropertyOptional({ example: '110', description: 'Start of a postal code' }) @IsOptional() @Matches(/^[A-Za-z0-9]{1,5}$/) pincodePrefix?: string;
  @ApiPropertyOptional({ example: 'IN', description: 'Country (default: your own; "all" for every country)' }) @IsOptional() @Matches(/^([A-Z]{2}|all)$/) country?: string;
}
