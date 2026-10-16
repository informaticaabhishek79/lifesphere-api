import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsLatitude, IsLongitude, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateIf } from 'class-validator';
import { Actor, CurrentActor, Idempotent } from '../../common/auth-context';
import { HelpService } from './help.service';

class HelpPreferencesDto {
  @ApiPropertyOptional({ example: '112' }) @IsOptional() @Matches(/^\+?\d{3,15}$/) emergencyNumber?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() primaryCallContactId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() notifyContacts?: boolean;
  @ApiPropertyOptional({ description: 'Turning this on records your consent to share location with help requests' }) @IsOptional() @IsBoolean() shareLocationByDefault?: boolean;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(200) defaultMessage?: string | null;
}

class HelpRequestDto {
  @ApiProperty({ enum: ['notify_contacts', 'call', 'service_request'] })
  @IsIn(['notify_contacts', 'call', 'service_request'])
  kind: 'notify_contacts' | 'call' | 'service_request';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) message?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() shareLocation?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsLatitude() lat?: number;
  @ApiPropertyOptional() @IsOptional() @IsLongitude() lng?: number;
  @ApiPropertyOptional({ description: 'Required for kind=service_request' }) @IsOptional() @IsUUID() serviceCategoryId?: string;
}

@ApiTags('help')
@Controller({ path: 'help', version: '1' })
export class HelpController {
  constructor(private readonly svc: HelpService) {}

  @Get('preferences')
  prefs(@CurrentActor() actor: Actor) {
    return this.svc.preferences(actor);
  }

  @Put('preferences')
  updatePrefs(@CurrentActor() actor: Actor, @Body() dto: HelpPreferencesDto) {
    return this.svc.updatePreferences(actor, dto);
  }

  /** The help button. Send an Idempotency-Key so a double tap or retry never sends twice. */
  @Idempotent()
  @Post('requests')
  request(@CurrentActor() actor: Actor, @Body() dto: HelpRequestDto) {
    return this.svc.request(actor, dto);
  }

  @Get('requests')
  mine(@CurrentActor() actor: Actor) {
    return this.svc.mine(actor);
  }

  /** Open help requests from people who chose you to receive their alerts. */
  @Get('requests/incoming')
  incoming(@CurrentActor() actor: Actor) {
    return this.svc.incoming(actor);
  }

  @Get('requests/:id')
  detail(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.detail(actor, id);
  }

  @Post('requests/:id/acknowledge')
  @HttpCode(200)
  ack(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.acknowledge(actor, id);
  }

  @Post('requests/:id/resolve')
  @HttpCode(200)
  resolve(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.resolve(actor, id);
  }

  @Post('requests/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.resolve(actor, id, true);
  }
}
