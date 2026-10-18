import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength, ValidateIf } from 'class-validator';
import { Actor, CurrentActor, RequireRecentAuth } from '../../common/auth-context';
import { RespondDto, TokenDto } from '../../common/dto';
import { ALL_SCOPES } from '../../common/policy.service';
import { ContactsService, SCOPE_LABELS } from './contacts.service';

class InviteContactDto {
  @ApiPropertyOptional({ example: '+919876543210' }) @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(254) email?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() userId?: string;
  @ApiPropertyOptional({ example: 'Neighbour' }) @IsOptional() @IsString() @MaxLength(40) label?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) message?: string;
  @ApiPropertyOptional({ enum: ALL_SCOPES, isArray: true, description: 'What you offer to share once they accept (cooling-off applies)' })
  @IsOptional()
  @IsIn(ALL_SCOPES, { each: true })
  @ArrayMaxSize(7)
  proposedScopes?: string[];
  @ApiPropertyOptional({ enum: ALL_SCOPES, isArray: true, description: 'What you ask them to share with you; they choose when accepting' })
  @IsOptional()
  @IsIn(ALL_SCOPES, { each: true })
  @ArrayMaxSize(7)
  requestedScopes?: string[];
}

class AcceptInviteDto extends TokenDto {
  @ApiPropertyOptional({ enum: ALL_SCOPES, isArray: true, description: 'Which of the requested things you agree to share back (cooling-off applies)' })
  @IsOptional()
  @IsIn(ALL_SCOPES, { each: true })
  @ArrayMaxSize(7)
  shareBack?: string[];
}

class RespondInviteDto extends RespondDto {
  @ApiPropertyOptional({ enum: ALL_SCOPES, isArray: true }) @IsOptional() @IsIn(ALL_SCOPES, { each: true }) @ArrayMaxSize(7) shareBack?: string[];
}

class ContactLabelDto {
  @ApiPropertyOptional({ nullable: true }) @ValidateIf((_, v) => v !== null) @IsString() @MaxLength(40) label: string | null;
}

class GrantCreateDto {
  @ApiProperty() @IsUUID() granteeId: string;
  @ApiProperty({ enum: ALL_SCOPES, isArray: true }) @IsIn(ALL_SCOPES, { each: true }) @ArrayMinSize(1) @ArrayMaxSize(7) scopes: string[];
  @ApiPropertyOptional({ description: 'Optional automatic end of sharing' }) @IsOptional() @IsDateString() expiresAt?: string;
}

class GrantListQuery {
  @ApiPropertyOptional({ enum: ['given', 'received', 'all'] }) @IsOptional() @IsIn(['given', 'received', 'all']) direction?: 'given' | 'received' | 'all';
  @ApiPropertyOptional() @IsOptional() @IsIn(['true', 'false']) includeInactive?: 'true' | 'false';
}

@ApiTags('contacts')
@Controller({ path: 'contacts', version: '1' })
export class ContactsController {
  constructor(private readonly svc: ContactsService) {}

  @Get()
  list(@CurrentActor() actor: Actor) {
    return this.svc.list(actor);
  }

  @Post('invitations')
  invite(@CurrentActor() actor: Actor, @Body() dto: InviteContactDto) {
    return this.svc.invite(actor, dto);
  }

  @Get('invitations')
  sent(@CurrentActor() actor: Actor) {
    return this.svc.sentInvitations(actor);
  }

  @Get('invitations/incoming')
  incoming(@CurrentActor() actor: Actor) {
    return this.svc.incomingInvitations(actor);
  }

  @Post('invitations/preview')
  @HttpCode(200)
  preview(@CurrentActor() actor: Actor, @Body() dto: TokenDto) {
    return this.svc.previewByToken(actor, dto.token);
  }

  @Post('invitations/accept')
  @HttpCode(200)
  accept(@CurrentActor() actor: Actor, @Body() dto: AcceptInviteDto) {
    return this.svc.respond(actor, { token: dto.token }, true, dto.shareBack);
  }

  @Post('invitations/:id/respond')
  @HttpCode(200)
  respond(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RespondInviteDto) {
    return this.svc.respond(actor, { id }, dto.accept, dto.shareBack);
  }

  @Delete('invitations/:id')
  @HttpCode(204)
  cancel(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.cancelInvitation(actor, id);
  }

  @Patch(':contactUserId')
  label(@CurrentActor() actor: Actor, @Param('contactUserId', ParseUUIDPipe) id: string, @Body() dto: ContactLabelDto) {
    return this.svc.setLabel(actor, id, dto.label);
  }

  /** Removes the contact both ways and revokes all sharing between you. */
  @Delete(':contactUserId')
  @HttpCode(204)
  remove(@CurrentActor() actor: Actor, @Param('contactUserId', ParseUUIDPipe) id: string) {
    return this.svc.remove(actor, id);
  }
}

@ApiTags('sharing')
@Controller({ path: 'grants', version: '1' })
export class GrantsController {
  constructor(private readonly svc: ContactsService) {}

  @Get('scopes')
  scopes() {
    return ALL_SCOPES.map((s) => ({ scope: s, meaning: SCOPE_LABELS[s] }));
  }

  @Get()
  list(@CurrentActor() actor: Actor, @Query() q: GrantListQuery) {
    return this.svc.grants(actor, q.direction ?? 'all', q.includeInactive === 'true');
  }

  @Get('who-can-see-me')
  whoCanSee(@CurrentActor() actor: Actor) {
    return this.svc.whoCanSee(actor);
  }

  /** Share specific things with a trusted contact. Needs recent re-authentication; starts after a cooling-off period. */
  @RequireRecentAuth(10)
  @Post()
  create(@CurrentActor() actor: Actor, @Body() dto: GrantCreateDto) {
    return this.svc.createGrants(actor, dto.granteeId, dto.scopes, dto.expiresAt);
  }

  /** Stop sharing (grantor) or stop receiving (grantee). Immediate. */
  @Delete(':id')
  @HttpCode(200)
  revoke(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.revoke(actor, id);
  }
}
