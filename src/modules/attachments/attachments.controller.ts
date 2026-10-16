import { Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { Actor, CurrentActor } from '../../common/auth-context';
import { badRequest } from '../../common/errors';
import { loadEnv } from '../../config/env';
import { AttachmentPurpose, AttachmentsService } from './attachments.service';

const PURPOSES: AttachmentPurpose[] = ['task', 'post', 'consumer_case', 'inventory', 'avatar', 'provider', 'civic'];

@ApiTags('attachments')
@Controller({ path: 'attachments', version: '1' })
export class AttachmentsController {
  constructor(private readonly svc: AttachmentsService) {}

  /** Upload a file (multipart field `file`). Images (JPEG/PNG/WebP) and, for some purposes, PDF. Type is checked from file content. */
  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiQuery({ name: 'purpose', enum: PURPOSES })
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: loadEnv().UPLOAD_MAX_BYTES + 1, files: 1 } }))
  upload(@CurrentActor() actor: Actor, @Query('purpose') purpose: string, @UploadedFile() file: Express.Multer.File) {
    if (!PURPOSES.includes(purpose as AttachmentPurpose)) throw badRequest(`purpose must be one of ${PURPOSES.join(', ')}`, 'invalid_purpose');
    return this.svc.upload(actor, purpose as AttachmentPurpose, file);
  }

  @Get(':id')
  async meta(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.out(await this.svc.get(actor, id));
  }

  @Get(':id/content')
  content(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    return this.svc.sendFile(actor, id, res);
  }

  /** Temporary attachments (consumer evidence) are deleted after 30 days unless kept. */
  @Post(':id/keep')
  @HttpCode(200)
  keep(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.keep(actor, id);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(actor, id);
  }
}
