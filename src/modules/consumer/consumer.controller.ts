import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { Actor, CurrentActor } from '../../common/auth-context';
import { CursorQuery } from '../../common/pagination';
import { AttachmentLinkDto } from '../tasks/tasks.dto';
import { ConsumerService } from './consumer.service';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ['draft', 'ready_to_submit', 'submitted_by_user', 'awaiting_response', 'info_required', 'resolved', 'closed'] as const;

class PurchaseCreateDto {
  @ApiProperty({ example: 'washing machine' }) @IsString() @MinLength(1) @MaxLength(60) productCategory: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) brand?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) model?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE) purchaseDate?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) retailerName?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE) warrantyExpiresOn?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(DATE) returnDeadline?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) serviceReference?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() inventoryItemId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() householdId?: string | null;
}
class UpdatePurchaseCreateDto extends PartialType(PurchaseCreateDto) {}

class PurchaseQuery {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(3650) expiringWithinDays?: number;
}

class ConsumerCaseDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) title: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) counterpartyName?: string;
  @ApiPropertyOptional({ example: 'ecommerce' }) @IsOptional() @IsString() @MaxLength(60) category?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() purchaseId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() officialChannelId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(DATE) nextFollowUpOn?: string | null;
}

class UpdateConsumerCaseDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(120) counterpartyName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) category?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() purchaseId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() officialChannelId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(DATE) nextFollowUpOn?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) resolutionNote?: string;
}

class ConsumerCaseQuery extends CursorQuery {
  @ApiPropertyOptional({ enum: STATUSES }) @IsOptional() @IsIn(STATUSES as unknown as string[]) status?: string;
}

class ConsumerCaseStatusDto {
  @ApiProperty({ enum: STATUSES }) @IsIn(STATUSES as unknown as string[]) status: (typeof STATUSES)[number];
  @ApiPropertyOptional({ description: 'Reference number exactly as given to you by the company or portal' }) @IsOptional() @IsString() @MaxLength(80) externalReference?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) note?: string;
  @ApiPropertyOptional({ description: 'You submitted your own text without an approved draft' }) @IsOptional() @IsBoolean() confirmSubmittedMyself?: boolean;
}

class ConsumerCaseEventDto {
  @ApiProperty({ enum: ['note', 'contact', 'response', 'follow_up'] }) @IsIn(['note', 'contact', 'response', 'follow_up']) kind: 'note' | 'contact' | 'response' | 'follow_up';
  @ApiProperty() @Matches(DATE) occurredOn: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(1000) description: string;
}

class ComplaintDraftDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(20000) body: string;
}

class GenerateDraftDto {
  @ApiProperty() @IsString() @MinLength(10) @MaxLength(4000) whatHappened: string;
  @ApiProperty({ example: 'Replace the product or refund the full amount' }) @IsString() @MinLength(3) @MaxLength(1000) whatYouWant: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() includeTimeline?: boolean;
  @ApiPropertyOptional({ enum: ['polite', 'firm'] }) @IsOptional() @IsIn(['polite', 'firm']) tone?: 'polite' | 'firm';
}

class OfficialChannelQuery {
  @ApiPropertyOptional({ enum: ['consumer', 'civic', 'government', 'helpline'] }) @IsOptional() @IsIn(['consumer', 'civic', 'government', 'helpline']) kind?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) topic?: string;
}

class ChecklistQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(40) category?: string;
}

@ApiTags('consumer')
@Controller({ path: 'consumer', version: '1' })
export class ConsumerController {
  constructor(private readonly svc: ConsumerService) {}

  @Get('purchases')
  purchases(@CurrentActor() actor: Actor, @Query() q: PurchaseQuery) {
    return this.svc.purchases(actor, q);
  }

  @Post('purchases')
  createPurchase(@CurrentActor() actor: Actor, @Body() dto: PurchaseCreateDto) {
    return this.svc.createPurchase(actor, dto);
  }

  @Get('purchases/:id')
  getPurchase(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getPurchase(actor, id);
  }

  @Patch('purchases/:id')
  updatePurchase(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePurchaseCreateDto) {
    return this.svc.updatePurchase(actor, id, dto);
  }

  @Delete('purchases/:id')
  @HttpCode(204)
  deletePurchase(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deletePurchase(actor, id);
  }

  @Get('cases')
  cases(@CurrentActor() actor: Actor, @Query() q: ConsumerCaseQuery) {
    return this.svc.cases(actor, q);
  }

  @Post('cases')
  createCase(@CurrentActor() actor: Actor, @Body() dto: ConsumerCaseDto) {
    return this.svc.createCase(actor, dto);
  }

  @Get('cases/:id')
  getCase(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.getCase(actor, id);
  }

  @Patch('cases/:id')
  updateCase(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateConsumerCaseDto) {
    return this.svc.updateCase(actor, id, dto);
  }

  @Post('cases/:id/status')
  @HttpCode(200)
  status(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConsumerCaseStatusDto) {
    return this.svc.setStatus(actor, id, dto);
  }

  @Delete('cases/:id')
  @HttpCode(204)
  deleteCase(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteCase(actor, id);
  }

  @Post('cases/:id/timeline')
  addEvent(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConsumerCaseEventDto) {
    return this.svc.addEvent(actor, id, dto);
  }

  @Delete('cases/:id/timeline/:eventId')
  @HttpCode(204)
  deleteEvent(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('eventId', ParseUUIDPipe) eventId: string) {
    return this.svc.deleteEvent(actor, id, eventId);
  }

  @Post('cases/:id/attachments')
  attach(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AttachmentLinkDto) {
    return this.svc.attach(actor, id, dto.attachmentId);
  }

  @Delete('cases/:id/attachments/:attachmentId')
  @HttpCode(204)
  detach(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('attachmentId', ParseUUIDPipe) aid: string) {
    return this.svc.detach(actor, id, aid);
  }

  @Post('cases/:id/drafts')
  saveDraft(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ComplaintDraftDto) {
    return this.svc.saveDraft(actor, id, dto.body);
  }

  /** AI draft from the details you give here. Nothing is sent anywhere. */
  @Post('cases/:id/drafts/generate')
  generate(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: GenerateDraftDto) {
    return this.svc.generateDraft(actor, id, dto);
  }

  @Patch('cases/:id/drafts/:draftId')
  updateDraft(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('draftId', ParseUUIDPipe) draftId: string, @Body() dto: ComplaintDraftDto) {
    return this.svc.updateDraft(actor, id, draftId, dto.body);
  }

  @Post('cases/:id/drafts/:draftId/approve')
  @HttpCode(200)
  approve(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('draftId', ParseUUIDPipe) draftId: string) {
    return this.svc.approveDraft(actor, id, draftId);
  }

  @Delete('cases/:id/drafts/:draftId')
  @HttpCode(204)
  deleteDraft(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('draftId', ParseUUIDPipe) draftId: string) {
    return this.svc.deleteDraft(actor, id, draftId);
  }

  @Get('evidence-checklist')
  checklist(@Query() q: ChecklistQuery) {
    return this.svc.checklist(q.category);
  }

  /** Curated official complaint and civic channels with last-reviewed dates. */
  @Get('official-channels')
  async channels(@CurrentActor() actor: Actor, @Query() q: OfficialChannelQuery) {
    return this.svc.officialChannels(q.kind, q.topic, await this.svc.countryOf(actor.userId));
  }
}
