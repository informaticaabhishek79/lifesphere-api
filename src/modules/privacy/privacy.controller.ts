import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { eq } from 'drizzle-orm';
import type { Response } from 'express';
import { Actor, CurrentActor, Public, RequireRecentAuth } from '../../common/auth-context';
import { notFound } from '../../common/errors';
import { Database, DB } from '../../db/db';
import { appConfig } from '../../db/schema';
import { AttachmentsService } from '../attachments/attachments.service';
import { DATA_INVENTORY, NOT_COLLECTED } from './data-inventory';
import { CONSENT_PURPOSES, ConsentPurpose, PrivacyService } from './privacy.service';

class GrantConsentDto {
  @ApiProperty({ enum: CONSENT_PURPOSES }) @IsIn(CONSENT_PURPOSES as unknown as string[]) purpose: ConsentPurpose;
  @ApiProperty({ example: '2026-10' }) @IsString() @MaxLength(20) policyVersion: string;
}

class CreatePrivacyRequestDto {
  @ApiProperty({ enum: ['export', 'correction', 'grievance'] })
  @IsIn(['export', 'correction', 'grievance'])
  type: 'export' | 'correction' | 'grievance';

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) details?: string;
}

class DeleteAccountDto {
  @ApiPropertyOptional({ description: 'Optional reason, helps us improve' }) @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

@ApiTags('privacy')
@Controller({ path: 'privacy', version: '1' })
export class PrivacyController {
  constructor(
    private readonly privacy: PrivacyService,
    private readonly attachments: AttachmentsService,
    @Inject(DB) private readonly db: Database,
  ) {}

  /** Current policy version and grievance / privacy contact details (configured by admins). */
  @Public()
  @Get('notice')
  async notice() {
    const rows = await this.db.select().from(appConfig).where(eq(appConfig.key, 'privacy_notice'));
    return (
      rows[0]?.value ?? {
        policyVersion: '2026-10',
        noticeUrl: null,
        grievanceOfficer: { name: null, email: null },
        note: 'Privacy notice not configured yet. Set app_config.privacy_notice.',
      }
    );
  }

  @Public()
  @Get('data-inventory')
  inventory() {
    return { collected: DATA_INVENTORY, neverCollected: NOT_COLLECTED };
  }

  @Get('consents')
  consents(@CurrentActor() actor: Actor) {
    return this.privacy.listConsents(actor.userId);
  }

  @Post('consents')
  grant(@CurrentActor() actor: Actor, @Body() dto: GrantConsentDto) {
    return this.privacy.grantConsent(actor, dto.purpose, dto.policyVersion);
  }

  @Delete('consents/:purpose')
  @HttpCode(200)
  withdraw(@CurrentActor() actor: Actor, @Param('purpose') purpose: string) {
    if (!(CONSENT_PURPOSES as readonly string[]).includes(purpose)) throw notFound('Consent');
    return this.privacy.withdrawConsent(actor, purpose as ConsentPurpose);
  }

  @Get('requests')
  requests(@CurrentActor() actor: Actor) {
    return this.privacy.listRequests(actor.userId);
  }

  @Post('requests')
  create(@CurrentActor() actor: Actor, @Body() dto: CreatePrivacyRequestDto) {
    return this.privacy.createRequest(actor, dto.type, dto.details);
  }

  /** Schedules permanent deletion after the grace period. Signing in again before then cancels it. */
  @RequireRecentAuth(10)
  @Post('delete-account')
  deleteAccount(@CurrentActor() actor: Actor, @Body() dto: DeleteAccountDto) {
    return this.privacy.createRequest(actor, 'delete', dto.reason);
  }

  @Get('requests/:id')
  async get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    const r = await this.privacy.getRequest(actor.userId, id);
    return { id: r.id, type: r.type, status: r.status, dueAt: r.dueAt, completedAt: r.completedAt, resolutionNote: r.resolutionNote, hasDownload: !!r.resultAttachmentId };
  }

  @Post('requests/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.privacy.cancelRequest(actor, id);
  }

  @Get('requests/:id/download')
  async download(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const r = await this.privacy.getRequest(actor.userId, id);
    if (!r.resultAttachmentId) throw notFound('Export file');
    await this.attachments.sendFile(actor, r.resultAttachmentId, res);
  }
}
