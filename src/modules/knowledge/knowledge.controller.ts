import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ArrayMaxSize, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { Actor, CurrentActor } from '../../common/auth-context';
import { CursorQuery } from '../../common/pagination';
import { KnowledgeService } from './knowledge.service';

class KnowledgeSearchQuery extends CursorQuery {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) q?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(60) topic?: string;
}

class AssistantAskDto {
  @ApiProperty({ example: 'How do I complain about a defective product bought online?' }) @IsString() @MinLength(3) @MaxLength(1000) question: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() conversationId?: string;
}

class AssistantFeedbackDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() messageId?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsUUID('all', { each: true }) @ArrayMaxSize(10) citedArticleIds?: string[];
  @ApiProperty({ enum: ['up', 'down'] }) @IsIn(['up', 'down']) rating: 'up' | 'down';
  @ApiPropertyOptional({ enum: ['inaccurate', 'outdated', 'not_helpful', 'unsafe', 'other'] })
  @IsOptional()
  @IsIn(['inaccurate', 'outdated', 'not_helpful', 'unsafe', 'other'])
  reason?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) comment?: string;
}

@ApiTags('knowledge')
@Controller({ path: 'knowledge', version: '1' })
export class KnowledgeController {
  constructor(private readonly svc: KnowledgeService) {}

  /** Topics of guides for your country plus general guides. */
  @Get('topics')
  async topics(@CurrentActor() actor: Actor) {
    return this.svc.topics(await this.svc.countryOf(actor.userId));
  }

  /** Guides for your country plus general guides. */
  @Get('articles')
  async search(@CurrentActor() actor: Actor, @Query() q: KnowledgeSearchQuery) {
    return this.svc.searchArticles(q, await this.svc.countryOf(actor.userId));
  }

  @Get('articles/:slug')
  article(@Param('slug') slug: string) {
    return this.svc.article(slug);
  }
}

@ApiTags('assistant')
@Controller({ path: 'assistant', version: '1' })
export class AssistantController {
  constructor(private readonly svc: KnowledgeService) {}

  /** Answers from LifeSphere's public guidance library with citations. Never acts on your behalf. */
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('ask')
  @HttpCode(200)
  ask(@CurrentActor() actor: Actor, @Body() dto: AssistantAskDto) {
    return this.svc.ask(actor, dto.question, dto.conversationId);
  }

  @Get('conversations')
  conversations(@CurrentActor() actor: Actor) {
    return this.svc.conversations(actor);
  }

  @Get('conversations/:id')
  conversation(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.conversation(actor, id);
  }

  @Delete('conversations')
  @HttpCode(200)
  deleteAll(@CurrentActor() actor: Actor) {
    return this.svc.deleteAllConversations(actor);
  }

  @Delete('conversations/:id')
  @HttpCode(204)
  delete(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.deleteConversation(actor, id);
  }

  @Post('feedback')
  feedback(@CurrentActor() actor: Actor, @Body() dto: AssistantFeedbackDto) {
    return this.svc.feedback(actor, dto);
  }
}
