import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Actor, CurrentActor } from '../../common/auth-context';
import { CursorQuery } from '../../common/pagination';
import { LocalityQuery, UpdatePreferencesDto, UpdateProfileDto } from './me.dto';
import { MeService } from './me.service';

@ApiTags('me')
@Controller({ path: 'me', version: '1' })
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get()
  get(@CurrentActor() actor: Actor) {
    return this.me.me(actor);
  }

  @Patch('profile')
  updateProfile(@CurrentActor() actor: Actor, @Body() dto: UpdateProfileDto) {
    return this.me.updateProfile(actor, dto);
  }

  @Get('preferences')
  async preferences(@CurrentActor() actor: Actor) {
    return (await this.me.me(actor)).preferences;
  }

  @Patch('preferences')
  updatePreferences(@CurrentActor() actor: Actor, @Body() dto: UpdatePreferencesDto) {
    return this.me.updatePreferences(actor, dto);
  }

  @Get('dashboard')
  dashboard(@CurrentActor() actor: Actor) {
    return this.me.dashboard(actor);
  }

  /** Your own activity and sharing audit trail. */
  @Get('activity')
  activity(@CurrentActor() actor: Actor, @Query() q: CursorQuery) {
    return this.me.myAudit(actor, q);
  }
}

@ApiTags('directory')
@Controller({ version: '1' })
export class DirectoryController {
  constructor(private readonly me: MeService) {}

  /** Approximate localities (neighbourhood level) for discovery. Never a precise address. */
  @Get('localities')
  localities(@Query() q: LocalityQuery) {
    return this.me.localities(q);
  }

  @Get('users/:id/card')
  card(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.me.userCard(actor, id);
  }
}
