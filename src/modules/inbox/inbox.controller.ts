import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsUUID, Max, Min, ValidateIf } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { Actor, CurrentActor } from '../../common/auth-context';
import { InboxService } from './inbox.service';

class InboxSetupDto {
  @ApiPropertyOptional({ description: 'Agree that files in the inbox are sent to the AI provider to be read' }) @IsOptional() @IsBoolean() aiConsent?: boolean;
  @ApiPropertyOptional({ nullable: true, description: 'Household for new shopping lists, inventory and budget lines' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  householdId?: string | null;
}

class InboxUpdateDto extends InboxSetupDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
}

class InboxListQuery {
  @ApiPropertyOptional({ default: 50 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

@ApiTags('Smart inbox')
@Controller({ path: 'inbox', version: '1' })
export class InboxController {
  constructor(private readonly svc: InboxService) {}

  @Get()
  status(@CurrentActor() actor: Actor) {
    return this.svc.status(actor);
  }

  /** Creates "LifeSphere Inbox" and its subfolders in Documents and turns the inbox on. */
  @Post('setup')
  @HttpCode(200)
  setup(@CurrentActor() actor: Actor, @Body() dto: InboxSetupDto) {
    return this.svc.setup(actor, dto);
  }

  @Patch()
  update(@CurrentActor() actor: Actor, @Body() dto: InboxUpdateDto) {
    return this.svc.update(actor, dto);
  }

  /** Look for files in the inbox that have not been read yet. */
  @Post('scan')
  @HttpCode(200)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async scan(@CurrentActor() actor: Actor) {
    return { queued: await this.svc.scanUser(actor.userId) };
  }

  @Get('imports')
  list(@CurrentActor() actor: Actor, @Query() q: InboxListQuery) {
    return this.svc.list(actor, q.limit ?? 50);
  }

  @Get('imports/:id')
  get(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.get(actor, id);
  }

  /** Removes everything this file added. */
  @Post('imports/:id/undo')
  @HttpCode(200)
  undo(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.undo(actor, id);
  }

  @Post('imports/:id/retry')
  @HttpCode(200)
  retry(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.retry(actor, id);
  }

  @Post('imports/:id/suggestions/:index/dismiss')
  @HttpCode(200)
  dismiss(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string, @Param('index', ParseIntPipe) index: number) {
    return this.svc.dismissSuggestion(actor, id, index);
  }
}
