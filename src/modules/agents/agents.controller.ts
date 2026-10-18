import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import type { Response } from 'express';
import { Actor, CurrentActor, Public } from '../../common/auth-context';
import { badRequest } from '../../common/errors';
import { AgentsService } from './agents.service';
import { MailService } from './mail.service';

class FolderGrantDto {
  @ApiProperty() @IsUUID() folderId: string;
  @ApiProperty({ enum: ['read', 'edit'], description: 'read = look only; edit = also create, rename, move and bin files' }) @IsIn(['read', 'edit']) access: 'read' | 'edit';
}

class AgentCreateDto {
  @ApiProperty({ enum: ['email', 'documents'] }) @IsIn(['email', 'documents']) kind: 'email' | 'documents';
  @ApiProperty({ example: 'Mail helper' }) @IsString() @MinLength(1) @MaxLength(80) name: string;
  @ApiPropertyOptional({ description: 'Standing instructions, e.g. tone or signature' }) @IsOptional() @IsString() @MaxLength(2000) instructions?: string;
  @ApiPropertyOptional({ nullable: true, description: 'Email agents: the mailbox it may use' }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() mailAccountId?: string | null;
  @ApiPropertyOptional({ description: 'Email agents: hold every reply for your approval' }) @IsOptional() @IsBoolean() reviewBeforeSending?: boolean;
  @ApiPropertyOptional({ type: [FolderGrantDto], description: 'Documents agents: the only folders it may use (subfolders included)' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => FolderGrantDto)
  folders?: FolderGrantDto[];
}

class AgentUpdateDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) instructions?: string;
  @ApiPropertyOptional({ enum: ['active', 'paused'] }) @IsOptional() @IsIn(['active', 'paused']) status?: 'active' | 'paused';
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() mailAccountId?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() reviewBeforeSending?: boolean;
  @ApiPropertyOptional({ type: [FolderGrantDto], description: 'Replaces the folder list' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => FolderGrantDto)
  folders?: FolderGrantDto[];
}

class EmailReplyDto {
  @ApiProperty({ description: 'The one email to reply to (id from the inbox list)' }) @IsString() @MinLength(1) @MaxLength(300) messageId: string;
  @ApiProperty({ example: 'Say Saturday 10–12 works and ask them to bring the spare part' }) @IsString() @MinLength(2) @MaxLength(2000) instruction: string;
  @ApiPropertyOptional({ description: 'Show the reply before it is sent (overrides the agent setting for this request)' }) @IsOptional() @IsBoolean() reviewFirst?: boolean;
}

class DocumentsRunDto {
  @ApiProperty({ example: 'Summarise the electricity bill and create a note with the due date' }) @IsString() @MinLength(2) @MaxLength(2000) instruction: string;
}

class ApproveDto {
  @ApiPropertyOptional({ description: 'Your edited version of the reply' }) @IsOptional() @IsString() @MinLength(1) @MaxLength(20000) body?: string;
}

class RunsQuery {
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

@ApiTags('agents')
@Controller({ path: 'agents', version: '1' })
export class AgentsController {
  constructor(private readonly svc: AgentsService) {}

  @Get()
  list(@CurrentActor() a: Actor) {
    return this.svc.list(a);
  }

  @Post()
  create(@CurrentActor() a: Actor, @Body() dto: AgentCreateDto) {
    return this.svc.create(a, dto);
  }

  /** Everything your agents did, newest first. */
  @Get('activity')
  activity(@CurrentActor() a: Actor, @Query() q: RunsQuery) {
    return this.svc.runs(a, undefined, q.limit);
  }

  @Get(':id')
  get(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(a, id);
  }

  @Patch(':id')
  update(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AgentUpdateDto) {
    return this.svc.update(a, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  remove(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.remove(a, id);
  }

  @Get(':id/activity')
  runs(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Query() q: RunsQuery) {
    return this.svc.runs(a, id, q.limit);
  }

  /** Email agents: reply to one chosen email. Sent straight away unless the agent (or this request) asks to review first. */
  @Post(':id/email/reply')
  @HttpCode(200)
  reply(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EmailReplyDto) {
    return this.svc.replyToEmail(a, id, dto);
  }

  /** Documents agents: carry out a request inside the granted folders only. */
  @Post(':id/documents/run')
  @HttpCode(200)
  runDocuments(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DocumentsRunDto) {
    return this.svc.runDocuments(a, id, dto.instruction);
  }

  @Post('activity/:runId/approve')
  @HttpCode(200)
  approve(@CurrentActor() a: Actor, @Param('runId', ParseUUIDPipe) runId: string, @Body() dto: ApproveDto) {
    return this.svc.approve(a, runId, dto.body);
  }

  @Post('activity/:runId/discard')
  @HttpCode(200)
  discard(@CurrentActor() a: Actor, @Param('runId', ParseUUIDPipe) runId: string) {
    return this.svc.discard(a, runId);
  }
}

class MessagesQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) pageToken?: string;
}

const PROVIDERS = ['gmail', 'outlook'] as const;
const oauthProvider = (p: string) => {
  if (!PROVIDERS.includes(p as (typeof PROVIDERS)[number])) throw badRequest('Unknown mail provider', 'invalid_provider');
  return p as 'gmail' | 'outlook';
};

@ApiTags('mail')
@Controller({ path: 'mail', version: '1' })
export class MailController {
  constructor(private readonly svc: MailService) {}

  /** Which mailbox types this server can connect. */
  @Get('providers')
  providers() {
    return this.svc.providers();
  }

  @Get('accounts')
  accounts(@CurrentActor() a: Actor) {
    return this.svc.list(a);
  }

  /** A sample mailbox for trying the email agent (development and demos). */
  @Post('accounts/demo')
  demo(@CurrentActor() a: Actor) {
    return this.svc.connectDemo(a);
  }

  @Delete('accounts/:id')
  @HttpCode(204)
  disconnect(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.disconnect(a, id);
  }

  /** Your inbox, read live from the provider. Nothing is stored. */
  @Get('accounts/:id/messages')
  messages(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Query() q: MessagesQuery) {
    return this.svc.messages(a.userId, id, q.pageToken);
  }

  @Get('accounts/:id/messages/:messageId')
  message(@CurrentActor() a: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('messageId') messageId: string) {
    return this.svc.message(a.userId, id, messageId);
  }

  /** Start connecting Gmail or Outlook; open the returned URL in the browser. */
  @Post('oauth/:provider/start')
  @HttpCode(200)
  start(@CurrentActor() a: Actor, @Param('provider') provider: string) {
    return this.svc.startOauth(a, oauthProvider(provider));
  }

  @Public()
  @Get('oauth/:provider/callback')
  @ApiQuery({ name: 'code', required: false })
  @ApiQuery({ name: 'state', required: false })
  @ApiQuery({ name: 'error', required: false })
  async callback(@Param('provider') provider: string, @Query('code') code: string | undefined, @Query('state') state: string | undefined, @Query('error') error: string | undefined, @Res() res: Response) {
    res.redirect(302, await this.svc.finishOauth(oauthProvider(provider), code, state, error));
  }
}
