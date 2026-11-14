import { Body, Controller, Get, HttpCode, Post, Put } from '@nestjs/common';
import { ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Actor, CurrentActor } from '../../common/auth-context';
import { VoiceService } from './voice.service';

class TurnDto {
  @ApiProperty({ enum: ['user', 'assistant'] }) @IsIn(['user', 'assistant']) role: 'user' | 'assistant';
  @ApiProperty() @IsString() @MaxLength(4000) text: string;
}

class AskDto {
  @ApiProperty({ example: 'What do I have today?' }) @IsString() @MinLength(1) @MaxLength(1000) question: string;
  @ApiPropertyOptional({ type: [TurnDto], description: 'The last few turns, kept by the app; nothing is stored on the server' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => TurnDto)
  history?: TurnDto[];
}

class SettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() speakAnswers?: boolean;
  @ApiPropertyOptional({ description: 'Document folders the assistant may read (folders inside included)' }) @IsOptional() @IsArray() @ArrayMaxSize(50) @IsUUID('all', { each: true }) documentFolderIds?: string[];
  @ApiPropertyOptional({ description: 'Open-ended "just talk to me" chat. Off by default — turn it on yourself.' }) @IsOptional() @IsBoolean() companionChatEnabled?: boolean;
}

class CompanionDto {
  @ApiProperty({ example: 'How are you today?' }) @IsString() @MinLength(1) @MaxLength(1000) message: string;
  @ApiPropertyOptional({ type: [TurnDto], description: 'The last few turns, kept by the app; nothing is stored on the server' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => TurnDto)
  history?: TurnDto[];
}

@ApiTags('voice-assistant')
@Controller({ path: 'voice', version: '1' })
export class VoiceController {
  constructor(private readonly svc: VoiceService) {}

  /** Ask anything about your own LifeSphere data or how to use it. Read-only: the assistant never changes anything. */
  @Post('ask')
  @HttpCode(200)
  ask(@CurrentActor() a: Actor, @Body() dto: AskDto) {
    return this.svc.ask(a, dto.question, dto.history ?? []);
  }

  @Get('settings')
  settings(@CurrentActor() a: Actor) {
    return this.svc.settings(a);
  }

  @Put('settings')
  update(@CurrentActor() a: Actor, @Body() dto: SettingsDto) {
    return this.svc.updateSettings(a, dto);
  }

  /**
   * Open-ended chat for company, not for answers — separate from `ask`, and off until turned on in settings.
   * Never reads or changes any LifeSphere data.
   */
  @Post('companion')
  @HttpCode(200)
  companion(@CurrentActor() a: Actor, @Body() dto: CompanionDto) {
    return this.svc.companion(a, dto.message, dto.history ?? []);
  }
}
