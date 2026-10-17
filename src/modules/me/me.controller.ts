import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Actor, CurrentActor, Public } from '../../common/auth-context';
import { COUNTRIES } from '../../common/countries';
import { getCountryCallingCode, type CountryCode } from 'libphonenumber-js/max';
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
  localities(@CurrentActor() actor: Actor, @Query() q: LocalityQuery) {
    return this.me.localities(q, actor);
  }

  /**
   * Every supported country with its calling code and local defaults (currency, emergency number, time zone,
   * language). Public: the sign-in screen needs it. Names are not included — render them with Intl.DisplayNames.
   */
  @Public()
  @Get('countries')
  countries() {
    return Object.values(COUNTRIES).map((c) => {
      let dialCode: string | null = null;
      try {
        dialCode = `+${getCountryCallingCode(c.code as CountryCode)}`;
      } catch {
        dialCode = null;
      }
      return { ...c, dialCode };
    });
  }

  @Get('users/:id/card')
  card(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    return this.me.userCard(actor, id);
  }
}
