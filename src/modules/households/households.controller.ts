import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { Actor, CurrentActor } from '../../common/auth-context';
import { RespondDto, TokenDto } from '../../common/dto';
import { HouseholdsService } from './households.service';

class HouseholdNameDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(80) name: string;
}

class HouseholdInviteDto {
  @ApiPropertyOptional({ example: '+919876543210' }) @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(254) email?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() userId?: string;
  @ApiPropertyOptional({ enum: ['admin', 'member'] }) @IsOptional() @IsIn(['admin', 'member']) role?: 'admin' | 'member';
}

class HouseholdRoleDto {
  @ApiProperty({ enum: ['admin', 'member'] }) @IsIn(['admin', 'member']) role: 'admin' | 'member';
}

class HouseholdAnnouncementDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(1000) body: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() pinned?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsDateString() expiresAt?: string;
}

class UpdateHouseholdAnnouncementDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(1000) body?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() pinned?: boolean;
}

@ApiTags('households')
@Controller({ path: 'households', version: '1' })
export class HouseholdsController {
  constructor(private readonly svc: HouseholdsService) {}

  @Post()
  create(@CurrentActor() actor: Actor, @Body() dto: HouseholdNameDto) {
    return this.svc.create(actor, dto.name);
  }

  @Get()
  list(@CurrentActor() actor: Actor) {
    return this.svc.listMine(actor);
  }

  @Get('invitations/incoming')
  incoming(@CurrentActor() actor: Actor) {
    return this.svc.incoming(actor);
  }

  /** Accept an invitation from a link token. Only works for the phone/email the invite was sent to. */
  @Post('invitations/accept')
  @HttpCode(200)
  acceptByToken(@CurrentActor() actor: Actor, @Body() dto: TokenDto) {
    return this.svc.respond(actor, { token: dto.token }, true);
  }

  @Post('invitations/:invitationId/respond')
  @HttpCode(200)
  respond(@CurrentActor() actor: Actor, @Param('invitationId', ParseUUIDPipe) invitationId: string, @Body() dto: RespondDto) {
    return this.svc.respond(actor, { id: invitationId }, dto.accept);
  }

  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(actor, id);
  }

  @Patch(':id')
  rename(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: HouseholdNameDto) {
    return this.svc.rename(actor, id, dto.name);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(actor, id);
  }

  @Post(':id/invitations')
  invite(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: HouseholdInviteDto) {
    return this.svc.invite(actor, id, dto);
  }

  @Get(':id/invitations')
  invitations(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.listInvitations(actor, id);
  }

  @Delete(':id/invitations/:invitationId')
  @HttpCode(204)
  cancelInvitation(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('invitationId', ParseUUIDPipe) invitationId: string) {
    return this.svc.cancelInvitation(actor, id, invitationId);
  }

  @Patch(':id/members/:userId')
  setRole(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: HouseholdRoleDto) {
    return this.svc.setRole(actor, id, userId, dto.role);
  }

  /** Remove a member (admin) or leave (yourself). */
  @Delete(':id/members/:userId')
  @HttpCode(200)
  removeMember(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.svc.removeMember(actor, id, userId);
  }

  @Get(':id/announcements')
  announcements(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.announcements(actor, id);
  }

  @Post(':id/announcements')
  announce(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: HouseholdAnnouncementDto) {
    return this.svc.announce(actor, id, dto);
  }

  @Patch(':id/announcements/:announcementId')
  updateAnnouncement(
    @CurrentActor() actor: Actor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('announcementId', ParseUUIDPipe) aid: string,
    @Body() dto: UpdateHouseholdAnnouncementDto,
  ) {
    return this.svc.updateAnnouncement(actor, id, aid, dto);
  }

  @Delete(':id/announcements/:announcementId')
  @HttpCode(204)
  deleteAnnouncement(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('announcementId', ParseUUIDPipe) aid: string) {
    return this.svc.deleteAnnouncement(actor, id, aid);
  }
}
