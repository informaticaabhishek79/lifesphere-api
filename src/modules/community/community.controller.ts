import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger';
import { ArrayMaxSize, IsBoolean, IsDateString, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { Actor, CurrentActor } from '../../common/auth-context';
import { RespondDto } from '../../common/dto';
import { CursorQuery } from '../../common/pagination';
import { ModerationService } from '../moderation/moderation.service';
import { CommunityService } from './community.service';

const POST_KINDS = ['text', 'announcement', 'event', 'recommendation', 'help_request', 'civic_info', 'lost_found'] as const;
const CIVIC = ['streetlight', 'garbage', 'road', 'water', 'drainage', 'electricity', 'public_safety', 'other'] as const;
const REASONS = ['spam', 'harassment', 'hate', 'fraud', 'impersonation', 'privacy', 'unsafe', 'misinformation', 'other'] as const;
const TARGETS = ['post', 'comment', 'user', 'group', 'provider', 'service_request', 'review'] as const;

class CommunityGroupDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(100) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @ApiPropertyOptional({ enum: ['public', 'private', 'invite_only'] }) @IsOptional() @IsIn(['public', 'private', 'invite_only']) visibility?: 'public' | 'private' | 'invite_only';
  @ApiPropertyOptional({ example: 'apartment' }) @IsOptional() @IsString() @MaxLength(40) category?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() localityId?: string | null;
  @ApiPropertyOptional({ enum: ['all_members', 'admins_only'] }) @IsOptional() @IsIn(['all_members', 'admins_only']) postingPolicy?: 'all_members' | 'admins_only';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) rules?: string;
}
class UpdateCommunityGroupDto extends PartialType(CommunityGroupDto) {}

class CommunityGroupQuery extends CursorQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) search?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() localityId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) category?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['true', 'false']) mine?: 'true' | 'false';
}

class GroupMemberQuery {
  @ApiPropertyOptional({ enum: ['active', 'pending'] }) @IsOptional() @IsIn(['active', 'pending']) status?: 'active' | 'pending';
}

class GroupMemberUpdateDto {
  @ApiPropertyOptional({ enum: ['admin', 'moderator', 'member'] }) @IsOptional() @IsIn(['admin', 'moderator', 'member']) role?: 'admin' | 'moderator' | 'member';
  @ApiPropertyOptional({ enum: ['active', 'banned'], description: 'active approves a pending request; banned removes and blocks rejoining' })
  @IsOptional()
  @IsIn(['active', 'banned'])
  status?: 'active' | 'banned';
}

class GroupInviteDto {
  @ApiProperty() @IsUUID() userId: string;
}

class CommunityPostDto {
  @ApiPropertyOptional({ enum: POST_KINDS }) @IsOptional() @IsIn(POST_KINDS as unknown as string[]) kind?: (typeof POST_KINDS)[number];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) title?: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(10000) body: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() eventStartsAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() eventEndsAt?: string;
  @ApiPropertyOptional({ description: 'Approximate place, never a home address' }) @IsOptional() @IsString() @MaxLength(200) eventLocationText?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsUUID('all', { each: true }) @ArrayMaxSize(6) attachmentIds?: string[];
}
class UpdateCommunityPostDto extends PartialType(CommunityPostDto) {}

class GroupPostQuery extends CursorQuery {
  @ApiPropertyOptional({ enum: POST_KINDS }) @IsOptional() @IsIn(POST_KINDS as unknown as string[]) kind?: string;
}
class CommunityFeedQuery extends GroupPostQuery {
  @ApiPropertyOptional() @IsOptional() @IsUUID() localityId?: string;
}

class CommunityCommentDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(2000) body: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() parentCommentId?: string;
}

class PostReactionDto {
  @ApiProperty({ enum: ['like', 'helpful', 'thanks', 'support'] }) @IsIn(['like', 'helpful', 'thanks', 'support']) kind: 'like' | 'helpful' | 'thanks' | 'support';
}

class PostPinDto {
  @ApiProperty() @IsBoolean() pinned: boolean;
}

class GroupModerateDto {
  @ApiProperty({ enum: ['hide', 'remove', 'restore'] }) @IsIn(['hide', 'remove', 'restore']) action: 'hide' | 'remove' | 'restore';
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(500) reason: string;
}

class ContentReportDto {
  @ApiProperty({ enum: TARGETS }) @IsIn(TARGETS as unknown as string[]) targetType: (typeof TARGETS)[number];
  @ApiProperty() @IsUUID() targetId: string;
  @ApiProperty({ enum: REASONS }) @IsIn(REASONS as unknown as string[]) reason: (typeof REASONS)[number];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) details?: string;
}

class ModerationAppealDto {
  @ApiProperty() @IsString() @MinLength(10) @MaxLength(2000) statement: string;
}

class CivicDto {
  @ApiProperty({ enum: CIVIC }) @IsIn(CIVIC as unknown as string[]) category: (typeof CIVIC)[number];
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(1000) description: string;
  @ApiPropertyOptional({ example: 'Near gate 2 of the park' }) @IsOptional() @IsString() @MaxLength(200) locationText?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() localityId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() officialChannelId?: string;
}

class CivicUpdateDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(5) @MaxLength(1000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) locationText?: string;
  @ApiPropertyOptional({ enum: ['draft', 'reported_by_user', 'in_progress', 'resolved', 'closed'] })
  @IsOptional()
  @IsIn(['draft', 'reported_by_user', 'in_progress', 'resolved', 'closed'])
  status?: 'draft' | 'reported_by_user' | 'in_progress' | 'resolved' | 'closed';
  @ApiPropertyOptional({ description: 'Exactly as given by the official channel' }) @IsOptional() @IsString() @MaxLength(80) externalReference?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() officialChannelId?: string;
}

class CivicShareDto {
  @ApiProperty() @IsUUID() groupId: string;
}

@ApiTags('community')
@Controller({ path: 'community', version: '1' })
export class CommunityController {
  constructor(
    private readonly svc: CommunityService,
    private readonly moderation: ModerationService,
  ) {}

  @Get('feed')
  feed(@CurrentActor() actor: Actor, @Query() q: CommunityFeedQuery) {
    return this.svc.feed(actor, q);
  }

  @Get('groups')
  groups(@CurrentActor() actor: Actor, @Query() q: CommunityGroupQuery) {
    return this.svc.discover(actor, { ...q, mine: q.mine === 'true' });
  }

  @Post('groups')
  createGroup(@CurrentActor() actor: Actor, @Body() dto: CommunityGroupDto) {
    return this.svc.createGroup(actor, dto);
  }

  @Get('groups/invitations')
  groupInvitations(@CurrentActor() actor: Actor) {
    return this.svc.myGroupInvitations(actor);
  }

  @Post('groups/invitations/:invitationId/respond')
  @HttpCode(200)
  respondInvitation(@CurrentActor() actor: Actor, @Param('invitationId', ParseUUIDPipe) id: string, @Body() dto: RespondDto) {
    return this.svc.respondGroupInvitation(actor, id, dto.accept);
  }

  @Get('groups/:id')
  group(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getGroup(actor, id);
  }

  @Patch('groups/:id')
  updateGroup(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCommunityGroupDto) {
    return this.svc.updateGroup(actor, id, dto);
  }

  @Delete('groups/:id')
  @HttpCode(204)
  archiveGroup(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.archiveGroup(actor, id);
  }

  @Post('groups/:id/join')
  @HttpCode(200)
  join(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.join(actor, id);
  }

  @Post('groups/:id/leave')
  @HttpCode(204)
  leave(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.leave(actor, id);
  }

  @Get('groups/:id/members')
  members(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Query() q: GroupMemberQuery) {
    return this.svc.members(actor, id, q.status);
  }

  @Patch('groups/:id/members/:userId')
  setMember(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string, @Body() dto: GroupMemberUpdateDto) {
    return this.svc.setMember(actor, id, userId, dto);
  }

  @Delete('groups/:id/members/:userId')
  @HttpCode(204)
  removeMember(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.svc.removeMember(actor, id, userId);
  }

  @Post('groups/:id/invitations')
  invite(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: GroupInviteDto) {
    return this.svc.inviteToGroup(actor, id, dto.userId);
  }

  @Get('groups/:id/posts')
  groupPosts(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Query() q: GroupPostQuery) {
    return this.svc.groupPosts(actor, id, q);
  }

  @Post('groups/:id/posts')
  createPost(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CommunityPostDto) {
    return this.svc.createPost(actor, id, dto);
  }

  @Get('posts/:id')
  post(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getPost(actor, id);
  }

  @Patch('posts/:id')
  updatePost(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCommunityPostDto) {
    return this.svc.updatePost(actor, id, dto);
  }

  @Delete('posts/:id')
  @HttpCode(204)
  deletePost(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deletePost(actor, id);
  }

  @Post('posts/:id/pin')
  @HttpCode(200)
  pin(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PostPinDto) {
    return this.svc.pinPost(actor, id, dto.pinned);
  }

  @Post('posts/:id/moderate')
  @HttpCode(200)
  moderate(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: GroupModerateDto) {
    return this.svc.moderatePost(actor, id, dto.action, dto.reason);
  }

  @Get('posts/:id/comments')
  comments(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Query() q: CursorQuery) {
    return this.svc.comments(actor, id, q);
  }

  @Post('posts/:id/comments')
  comment(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CommunityCommentDto) {
    return this.svc.addComment(actor, id, dto.body, dto.parentCommentId);
  }

  @Patch('comments/:id')
  updateComment(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CommunityCommentDto) {
    return this.svc.updateComment(actor, id, dto.body);
  }

  @Delete('comments/:id')
  @HttpCode(204)
  deleteComment(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteComment(actor, id);
  }

  @Get('posts/:id/reactions')
  reactions(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.reactionSummary(actor, id);
  }

  @Put('posts/:id/reaction')
  react(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PostReactionDto) {
    return this.svc.react(actor, id, dto.kind);
  }

  @Delete('posts/:id/reaction')
  @HttpCode(204)
  unreact(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.unreact(actor, id);
  }

  @Get('bookmarks')
  bookmarks(@CurrentActor() actor: Actor, @Query() q: CursorQuery) {
    return this.svc.bookmarks(actor, q);
  }

  @Put('posts/:id/bookmark')
  bookmark(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.bookmark(actor, id);
  }

  @Delete('posts/:id/bookmark')
  @HttpCode(204)
  unbookmark(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.unbookmark(actor, id);
  }

  @Get('blocks')
  blocks(@CurrentActor() actor: Actor) {
    return this.svc.blocks(actor);
  }

  @Put('blocks/:userId')
  block(@CurrentActor() actor: Actor, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.svc.block(actor, userId);
  }

  @Delete('blocks/:userId')
  @HttpCode(204)
  unblock(@CurrentActor() actor: Actor, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.svc.unblock(actor, userId);
  }

  // ---------------------------------------------------------------- reports & appeals (any user)
  @Post('reports')
  report(@CurrentActor() actor: Actor, @Body() dto: ContentReportDto) {
    return this.moderation.report(actor, dto, (t, id) => this.svc.canSeeTarget(actor, t, id));
  }

  @Get('reports')
  myReports(@CurrentActor() actor: Actor) {
    return this.moderation.myReports(actor);
  }

  /** Moderation decisions that affect you, which you can appeal within 30 days. */
  @Get('moderation-decisions')
  decisions(@CurrentActor() actor: Actor) {
    return this.moderation.myActions(actor);
  }

  @Post('moderation-decisions/:id/appeal')
  appeal(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ModerationAppealDto) {
    return this.moderation.appeal(actor, id, dto.statement);
  }
}

@ApiTags('civic')
@Controller({ path: 'civic-issues', version: '1' })
export class CivicController {
  constructor(private readonly svc: CommunityService) {}

  @Get()
  list(@CurrentActor() actor: Actor) {
    return this.svc.civicList(actor);
  }

  @Post()
  create(@CurrentActor() actor: Actor, @Body() dto: CivicDto) {
    return this.svc.civicCreate(actor, dto);
  }

  @Get(':id')
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.civicGet(actor, id);
  }

  @Patch(':id')
  update(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CivicUpdateDto) {
    return this.svc.civicUpdate(actor, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.civicDelete(actor, id);
  }

  @Post(':id/share')
  share(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CivicShareDto) {
    return this.svc.civicShare(actor, id, dto.groupId);
  }
}
