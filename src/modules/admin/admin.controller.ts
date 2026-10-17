import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { Actor, CurrentActor, RequireRecentAuth, StaffOnly, StaffRoleName } from '../../common/auth-context';
import { CursorQuery } from '../../common/pagination';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { ModerationService } from '../moderation/moderation.service';
import { AdminService } from './admin.service';

const ROLES: StaffRoleName[] = ['support', 'moderator', 'privacy_officer', 'provider_reviewer', 'content_admin', 'super_admin'];
const TARGETS = ['post', 'comment', 'user', 'group', 'provider', 'service_request', 'review'] as const;
const ACTIONS = ['hide', 'remove', 'restore', 'warn', 'suspend_posting', 'suspend', 'ban', 'dismiss'] as const;

class UserSearchQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(20) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(254) email?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() userId?: string;
}
class AdminReasonDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(500) reason: string;
}
class OptionalReasonDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
class StaffRoleGrantDto {
  @ApiProperty() @IsUUID() userId: string;
  @ApiProperty({ enum: ROLES }) @IsIn(ROLES) role: StaffRoleName;
}
class PrivacyQuery extends CursorQuery {
  @ApiPropertyOptional() @IsOptional() @IsIn(['received', 'in_progress', 'completed', 'rejected', 'cancelled']) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['export', 'delete', 'correction', 'grievance']) type?: string;
}
class PrivacyActionDto {
  @ApiProperty({ enum: ['start', 'complete', 'reject', 'retry_export'] }) @IsIn(['start', 'complete', 'reject', 'retry_export']) action: 'start' | 'complete' | 'reject' | 'retry_export';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) note?: string;
}
class ReportQueueQuery extends CursorQuery {
  @ApiPropertyOptional() @IsOptional() @IsIn(['open', 'in_review', 'actioned', 'dismissed']) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) reason?: string;
  @ApiPropertyOptional({ enum: TARGETS }) @IsOptional() @IsIn(TARGETS as unknown as string[]) targetType?: string;
  @ApiPropertyOptional() @IsOptional() @IsIn(['true', 'false']) assignedToMe?: 'true' | 'false';
}
class ModerationActionDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() reportId?: string;
  @ApiProperty({ enum: TARGETS }) @IsIn(TARGETS as unknown as string[]) targetType: (typeof TARGETS)[number];
  @ApiProperty() @IsUUID() targetId: string;
  @ApiProperty({ enum: ACTIONS }) @IsIn(ACTIONS as unknown as string[]) action: (typeof ACTIONS)[number];
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(500) reason: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(3650) durationDays?: number;
}
class AppealDecisionDto {
  @ApiProperty({ enum: ['upheld', 'overturned'] }) @IsIn(['upheld', 'overturned']) decision: 'upheld' | 'overturned';
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(1000) note: string;
}
class AdminProviderQuery extends CursorQuery {
  @ApiPropertyOptional() @IsOptional() @IsIn(['draft', 'pending_review', 'active', 'suspended', 'rejected']) status?: string;
}
class ProviderDecisionDto {
  @ApiProperty({ enum: ['approve', 'reject', 'suspend', 'reinstate'] }) @IsIn(['approve', 'reject', 'suspend', 'reinstate']) decision: 'approve' | 'reject' | 'suspend' | 'reinstate';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
class VerificationDto {
  @ApiProperty({ enum: ['identity', 'address', 'background', 'business_registration', 'reference', 'training'] })
  @IsIn(['identity', 'address', 'background', 'business_registration', 'reference', 'training'])
  checkType: 'identity' | 'address' | 'background' | 'business_registration' | 'reference' | 'training';
  @ApiProperty({ enum: ['pending', 'passed', 'failed'] }) @IsIn(['pending', 'passed', 'failed']) status: 'pending' | 'passed' | 'failed';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) performedByPartner?: string;
  @ApiPropertyOptional({ description: 'Never include ID numbers' }) @IsOptional() @IsString() @MaxLength(500) note?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() expiresAt?: string;
}
class SponsorshipDto {
  @ApiProperty() @IsBoolean() isSponsored: boolean;
  @ApiPropertyOptional() @IsOptional() @IsDateString() sponsoredUntil?: string;
}
class ServiceCategoryDto {
  @ApiProperty() @Matches(/^[a-z0-9-]{2,60}$/) slug: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(80) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() parentId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requiresVerification?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() seniorSupport?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1000) sortOrder?: number;
}
class UpdateServiceCategoryDto extends PartialType(ServiceCategoryDto) {}
class LocalityUpsertDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) name: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(80) city: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(80) state: string;
  @ApiPropertyOptional({ example: 'IN' }) @IsOptional() @Matches(/^[A-Z]{2}$/) country?: string;
  @ApiPropertyOptional({ example: '110', description: 'Start of the postal code (e.g. 3 PIN digits, UK outward code)' }) @IsOptional() @Matches(/^[A-Za-z0-9]{1,5}$/) pincodePrefix?: string;
  @ApiPropertyOptional({ description: 'Rounded to 2 decimals (~1 km)' }) @IsOptional() @Matches(/^-?\d{1,3}(\.\d+)?$/) lat?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^-?\d{1,3}(\.\d+)?$/) lng?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}
class UpdateLocalityUpsertDto extends PartialType(LocalityUpsertDto) {}
class OfficialChannelDto {
  @ApiProperty({ enum: ['consumer', 'civic', 'government', 'helpline'] }) @IsIn(['consumer', 'civic', 'government', 'helpline']) kind: 'consumer' | 'civic' | 'government' | 'helpline';
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(160) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) jurisdiction?: string;
  @ApiPropertyOptional({ example: 'IN', description: 'Country served; leave empty for every country', nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(/^[A-Z]{2}$/) country?: string | null;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsString({ each: true }) @ArrayMaxSize(30) topics?: string[];
  @ApiPropertyOptional() @IsOptional() @IsUrl({ protocols: ['https', 'http'], require_protocol: true }) @MaxLength(400) url?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) lastReviewedOn?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}
class UpdateOfficialChannelDto extends PartialType(OfficialChannelDto) {}
class ConfigValueDto {
  @ApiProperty() @IsObject() value: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) description?: string;
}
class PlanUpsertDto {
  @ApiProperty() @Matches(/^[a-z0-9_]{2,40}$/) code: string;
  @ApiProperty() @IsString() @MaxLength(80) name: string;
  @ApiProperty({ enum: ['user', 'household', 'provider'] }) @IsIn(['user', 'household', 'provider']) subject: 'user' | 'household' | 'provider';
  @ApiPropertyOptional() @IsOptional() @IsObject() features?: Record<string, number | boolean>;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}
class SubscriptionGrantDto {
  @ApiProperty({ enum: ['user', 'household', 'provider'] }) @IsIn(['user', 'household', 'provider']) subjectType: 'user' | 'household' | 'provider';
  @ApiProperty() @IsUUID() subjectId: string;
  @ApiProperty() @IsString() @MaxLength(40) planCode: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() endsAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) source?: string;
}
class AdminAuditQuery extends CursorQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) action?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() actorId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) targetType?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() targetId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() subjectUserId?: string;
}
class KnowledgeSourceDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(160) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) publisher?: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true }) @MaxLength(400) url?: string;
  @ApiProperty({ enum: ['official', 'ngo', 'internal', 'other'] }) @IsIn(['official', 'ngo', 'internal', 'other']) kind: 'official' | 'ngo' | 'internal' | 'other';
  @ApiPropertyOptional({ minimum: 1, maximum: 3 }) @IsOptional() @IsInt() @Min(1) @Max(3) reliabilityTier?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) reliabilityNote?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(7) @Max(1095) reviewIntervalDays?: number;
}
class UpdateKnowledgeSourceDto extends PartialType(KnowledgeSourceDto) {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}
class KnowledgeArticleDto {
  @ApiProperty() @IsUUID() sourceId: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(240) title: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) summary?: string;
  @ApiPropertyOptional({ description: 'Markdown-ish text; or use fetchUrl' }) @IsOptional() @IsString() @MaxLength(200000) body?: string;
  @ApiPropertyOptional({ description: 'https page to ingest (official source)' }) @IsOptional() @IsUrl({ protocols: ['https'], require_protocol: true }) fetchUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl({ protocols: ['https', 'http'], require_protocol: true }) canonicalUrl?: string;
  @ApiProperty({ example: 'consumer_complaints' }) @IsString() @MinLength(2) @MaxLength(60) topic: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(10) language?: string;
  @ApiPropertyOptional({ example: 'IN', description: 'Country the guide applies to; leave empty for general guidance' }) @IsOptional() @Matches(/^[A-Z]{2}$/) country?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) publishedOn?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) lastReviewedOn?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) disclaimer?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() publish?: boolean;
}
class UpdateKnowledgeArticleDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(3) @MaxLength(240) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) summary?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200000) body?: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl({ protocols: ['https', 'http'], require_protocol: true }) canonicalUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) topic?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(/^[A-Z]{2}$/) country?: string | null;
  @ApiPropertyOptional() @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) lastReviewedOn?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) disclaimer?: string;
  @ApiPropertyOptional({ enum: ['draft', 'published', 'archived'] }) @IsOptional() @IsIn(['draft', 'published', 'archived']) status?: 'draft' | 'published' | 'archived';
}
class AdminArticleQuery extends CursorQuery {
  @ApiPropertyOptional() @IsOptional() @IsIn(['draft', 'published', 'archived']) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() sourceId?: string;
}
class AssistantEvalCaseDto {
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(500) question: string;
  @ApiProperty({ type: [String] }) @IsUUID('all', { each: true }) @ArrayMaxSize(10) expectedArticleIds: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsString({ each: true }) @ArrayMaxSize(20) mustNotContain?: string[];
}

@ApiTags('admin')
@StaffOnly()
@Controller({ path: 'admin', version: '1' })
export class AdminController {
  constructor(
    private readonly svc: AdminService,
    private readonly moderation: ModerationService,
    private readonly knowledge: KnowledgeService,
  ) {}

  @Get('overview')
  overview() {
    return this.svc.overview();
  }

  @Get('me')
  me(@CurrentActor() actor: Actor) {
    return { userId: actor.userId, roles: actor.staffRoles, mfaVerified: actor.mfaVerified };
  }

  // users
  @StaffOnly('support')
  @Get('users')
  users(@Query() q: UserSearchQuery) {
    return this.svc.findUsers(q);
  }

  @StaffOnly('support')
  @RequireRecentAuth(15)
  @Post('users/:id/disable')
  @HttpCode(200)
  disable(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminReasonDto) {
    return this.svc.setUserStatus(actor, id, true, dto.reason);
  }

  @StaffOnly('support')
  @RequireRecentAuth(15)
  @Post('users/:id/enable')
  @HttpCode(200)
  enable(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AdminReasonDto) {
    return this.svc.setUserStatus(actor, id, false, dto.reason);
  }

  @StaffOnly('support')
  @Post('users/:id/revoke-sessions')
  @HttpCode(200)
  revokeSessions(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.revokeSessions(actor, id);
  }

  // staff
  @StaffOnly('super_admin')
  @Get('staff')
  staff() {
    return this.svc.staff();
  }

  @StaffOnly('super_admin')
  @RequireRecentAuth(10)
  @Post('staff')
  grant(@CurrentActor() actor: Actor, @Body() dto: StaffRoleGrantDto) {
    return this.svc.grantRole(actor, dto.userId, dto.role);
  }

  @StaffOnly('super_admin')
  @RequireRecentAuth(10)
  @Delete('staff/:id')
  @HttpCode(200)
  revoke(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.revokeRole(actor, id);
  }

  // privacy
  @StaffOnly('privacy_officer')
  @Get('privacy-requests')
  privacyRequests(@Query() q: PrivacyQuery) {
    return this.svc.privacyRequests(q);
  }

  @StaffOnly('privacy_officer')
  @Post('privacy-requests/:id/action')
  @HttpCode(200)
  privacyAction(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PrivacyActionDto) {
    return this.svc.handlePrivacyRequest(actor, id, dto.action, dto.note);
  }

  // moderation
  @StaffOnly('moderator')
  @Get('moderation/reports')
  reports(@CurrentActor() actor: Actor, @Query() q: ReportQueueQuery) {
    return this.moderation.queue({ ...q, assignedToMe: q.assignedToMe === 'true' }, actor);
  }

  @StaffOnly('moderator')
  @Get('moderation/reports/:id')
  report(@Param('id', ParseUUIDPipe) id: string) {
    return this.moderation.reportDetail(id);
  }

  @StaffOnly('moderator')
  @Post('moderation/reports/:id/assign')
  @HttpCode(200)
  assign(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.moderation.assign(actor, id);
  }

  @StaffOnly('moderator')
  @Post('moderation/actions')
  act(@CurrentActor() actor: Actor, @Body() dto: ModerationActionDto) {
    return this.moderation.act(actor, dto, 'platform');
  }

  @StaffOnly('moderator')
  @Get('moderation/actions')
  log(@Query() q: CursorQuery) {
    return this.moderation.moderationLog(q);
  }

  @StaffOnly('moderator')
  @Get('moderation/appeals')
  appeals(@Query('status') status?: string) {
    return this.moderation.appeals(status ?? 'open');
  }

  @StaffOnly('moderator')
  @Post('moderation/appeals/:id/decide')
  @HttpCode(200)
  decide(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AppealDecisionDto) {
    return this.moderation.decideAppeal(actor, id, dto.decision, dto.note);
  }

  @StaffOnly('moderator')
  @Post('moderation/sanctions/:id/lift')
  @HttpCode(200)
  lift(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.moderation.liftSanction(actor, id);
  }

  // providers
  @StaffOnly('provider_reviewer')
  @Get('providers')
  providers(@Query() q: AdminProviderQuery) {
    return this.svc.providers(q);
  }

  @StaffOnly('provider_reviewer')
  @Get('providers/:id')
  provider(@Param('id', ParseUUIDPipe) id: string) {
    return this.svc.provider(id);
  }

  @StaffOnly('provider_reviewer')
  @Post('providers/:id/decision')
  @HttpCode(200)
  decideProvider(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ProviderDecisionDto) {
    return this.svc.decideProvider(actor, id, dto.decision, dto.reason);
  }

  @StaffOnly('provider_reviewer')
  @Post('providers/:id/verification')
  verify(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VerificationDto) {
    return this.svc.recordVerification(actor, id, dto);
  }

  @StaffOnly('super_admin')
  @Put('providers/:id/sponsorship')
  sponsor(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SponsorshipDto) {
    return this.svc.setSponsorship(actor, id, dto.isSponsored, dto.sponsoredUntil);
  }

  // catalogue
  @StaffOnly('content_admin')
  @Post('service-categories')
  createCategory(@CurrentActor() actor: Actor, @Body() dto: ServiceCategoryDto) {
    return this.svc.upsertCategory(actor, null, dto);
  }

  @StaffOnly('content_admin')
  @Patch('service-categories/:id')
  updateCategory(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateServiceCategoryDto) {
    return this.svc.upsertCategory(actor, id, dto);
  }

  @StaffOnly('content_admin')
  @Post('localities')
  createLocality(@CurrentActor() actor: Actor, @Body() dto: LocalityUpsertDto) {
    return this.svc.upsertLocality(actor, null, dto);
  }

  @StaffOnly('content_admin')
  @Patch('localities/:id')
  updateLocality(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLocalityUpsertDto) {
    return this.svc.upsertLocality(actor, id, dto);
  }

  @StaffOnly('content_admin')
  @Get('official-channels')
  channels() {
    return this.svc.channels();
  }

  @StaffOnly('content_admin')
  @Post('official-channels')
  createChannel(@CurrentActor() actor: Actor, @Body() dto: OfficialChannelDto) {
    return this.svc.upsertChannel(actor, null, dto);
  }

  @StaffOnly('content_admin')
  @Patch('official-channels/:id')
  updateChannel(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOfficialChannelDto) {
    return this.svc.upsertChannel(actor, id, dto);
  }

  // knowledge
  @StaffOnly('content_admin')
  @Get('knowledge/sources')
  sources() {
    return this.knowledge.listSources();
  }

  @StaffOnly('content_admin')
  @Post('knowledge/sources')
  createSource(@CurrentActor() actor: Actor, @Body() dto: KnowledgeSourceDto) {
    return this.knowledge.createSource(actor, dto);
  }

  @StaffOnly('content_admin')
  @Patch('knowledge/sources/:id')
  updateSource(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateKnowledgeSourceDto) {
    return this.knowledge.updateSource(actor, id, dto);
  }

  @StaffOnly('content_admin')
  @Get('knowledge/articles')
  articles(@Query() q: AdminArticleQuery) {
    return this.knowledge.adminArticles(q);
  }

  @StaffOnly('content_admin')
  @Get('knowledge/articles/review-due')
  reviewDue() {
    return this.knowledge.reviewDue();
  }

  @StaffOnly('content_admin')
  @Get('knowledge/articles/:slug')
  article(@Param('slug') slug: string) {
    return this.knowledge.article(slug, true);
  }

  @StaffOnly('content_admin')
  @Post('knowledge/articles')
  createArticle(@CurrentActor() actor: Actor, @Body() dto: KnowledgeArticleDto) {
    return this.knowledge.createArticle(actor, dto);
  }

  @StaffOnly('content_admin')
  @Patch('knowledge/articles/:id')
  updateArticle(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateKnowledgeArticleDto) {
    return this.knowledge.updateArticle(actor, id, dto);
  }

  @StaffOnly('content_admin')
  @Delete('knowledge/articles/:id')
  @HttpCode(204)
  deleteArticle(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.knowledge.deleteArticle(actor, id);
  }

  @StaffOnly('content_admin')
  @Get('assistant/eval-cases')
  evalCases() {
    return this.knowledge.evalCases();
  }

  @StaffOnly('content_admin')
  @Post('assistant/eval-cases')
  addEval(@Body() dto: AssistantEvalCaseDto) {
    return this.knowledge.addEvalCase(dto);
  }

  @StaffOnly('content_admin')
  @Delete('assistant/eval-cases/:id')
  @HttpCode(204)
  deleteEval(@Param('id', ParseUUIDPipe) id: string) {
    return this.knowledge.deleteEvalCase(id);
  }

  @StaffOnly('content_admin')
  @Post('assistant/eval-runs')
  runEval(@CurrentActor() actor: Actor) {
    return this.knowledge.runEval(actor);
  }

  @StaffOnly('content_admin')
  @Get('assistant/eval-runs')
  evalRuns() {
    return this.knowledge.evalRuns();
  }

  @StaffOnly('content_admin')
  @Get('assistant/feedback-summary')
  feedbackSummary() {
    return this.knowledge.feedbackSummary();
  }

  // platform
  @StaffOnly('super_admin')
  @Get('config')
  config() {
    return this.svc.config();
  }

  @StaffOnly('super_admin')
  @Put('config/:key')
  setConfig(@CurrentActor() actor: Actor, @Param('key') key: string, @Body() dto: ConfigValueDto) {
    return this.svc.setConfig(actor, key.slice(0, 80), dto.value, dto.description);
  }

  @StaffOnly('super_admin')
  @Get('plans')
  plans() {
    return this.svc.plans();
  }

  @StaffOnly('super_admin')
  @Put('plans')
  upsertPlan(@CurrentActor() actor: Actor, @Body() dto: PlanUpsertDto) {
    return this.svc.upsertPlan(actor, dto);
  }

  @StaffOnly('super_admin')
  @Post('subscriptions')
  subscription(@CurrentActor() actor: Actor, @Body() dto: SubscriptionGrantDto) {
    return this.svc.grantSubscription(actor, dto);
  }

  @StaffOnly('support', 'privacy_officer')
  @Get('audit')
  audit(@Query() q: AdminAuditQuery) {
    return this.svc.auditLog(q);
  }

  @StaffOnly('support')
  @Get('notifications/failures')
  failures() {
    return this.svc.notificationFailures();
  }
}

void OptionalReasonDto;
