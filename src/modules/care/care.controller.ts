import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsBoolean, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import { Actor, CurrentActor } from '../../common/auth-context';
import { CareService } from './care.service';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

class MedicineDto {
  @ApiProperty({ example: 'BP tablet', description: 'A simple name. People you choose to alert will see it.' }) @IsString() @MinLength(1) @MaxLength(60) name: string;
  @ApiProperty({ example: ['08:00', '20:00'] }) @Matches(HHMM, { each: true }) @ArrayMinSize(1) @ArrayMaxSize(4) times: string[];
}

class CareSetupDto {
  @ApiPropertyOptional({ example: '10:00', nullable: true, description: 'Daily "Are you OK?" time; null to skip' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(HHMM)
  checkInTime?: string | null;
  @ApiPropertyOptional({ example: 'Daily check-in', description: 'Name for the daily check-in, in the person’s language' }) @IsOptional() @IsString() @MaxLength(80) checkInLabel?: string;
  @ApiPropertyOptional({ type: [String], description: 'Contacts who hold a checkins.alerts grant from you' }) @IsOptional() @IsUUID('all', { each: true }) @ArrayMaxSize(5) alertContactIds?: string[];
  @ApiPropertyOptional({ description: 'Needed the first time contacts are to be alerted' }) @IsOptional() @IsBoolean() consentToAlertContacts?: boolean;
  @ApiPropertyOptional({ type: [MedicineDto] }) @IsOptional() @ValidateNested({ each: true }) @Type(() => MedicineDto) @ArrayMaxSize(10) medicines?: MedicineDto[];
  @ApiPropertyOptional({ description: 'Also tell the alert contacts when a medicine is not confirmed' }) @IsOptional() @IsBoolean() medicineAlerts?: boolean;
  @ApiPropertyOptional({ nullable: true, description: 'Trusted contact to offer as the first call in Get help' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  primaryCallContactId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() largerText?: boolean;
  @ApiPropertyOptional({ default: true, description: 'Hide features unrelated to care (they can be turned back on in Settings)' }) @IsOptional() @IsBoolean() focus?: boolean;
}

class CareModeDto {
  @ApiProperty({ enum: ['standard', 'caregiver', 'cared_for'] }) @IsIn(['standard', 'caregiver', 'cared_for']) mode: 'standard' | 'caregiver' | 'cared_for';
  @ApiPropertyOptional({ default: true }) @IsOptional() @IsBoolean() focus?: boolean;
}

@ApiTags('care')
@Controller({ path: 'care', version: '1' })
export class CareController {
  constructor(private readonly svc: CareService) {}

  /** For a caregiver: each person who shares with you, today's check-in and medicines, help alerts and appointments. */
  @Get('people')
  people(@CurrentActor() actor: Actor) {
    return this.svc.people(actor);
  }

  /** For the person being looked after: the simple home. */
  @Get('today')
  today(@CurrentActor() actor: Actor) {
    return this.svc.today(actor);
  }

  @Post('setup')
  @HttpCode(200)
  setup(@CurrentActor() actor: Actor, @Body() dto: CareSetupDto) {
    return this.svc.setup(actor, dto);
  }

  @Post('mode')
  @HttpCode(200)
  mode(@CurrentActor() actor: Actor, @Body() dto: CareModeDto) {
    return this.svc.setMode(actor, dto.mode, dto.focus ?? true);
  }
}
