import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Actor, CurrentActor, Public, RequireRecentAuth } from '../../common/auth-context';
import {
  ContactVerifyDto,
  ContactVerifyRequestDto,
  DisableTotpDto,
  MfaVerifyDto,
  OtpRequestDto,
  OtpVerifyDto,
  ReauthRequestDto,
  ReauthVerifyDto,
  RefreshDto,
  TotpConfirmDto,
} from './auth.dto';
import { AuthService } from './auth.service';

@ApiTags('auth')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Sends a one-time code. Works for both sign-in and sign-up; the response never reveals whether an account exists. */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('otp/request')
  @HttpCode(200)
  requestOtp(@Body() dto: OtpRequestDto, @Req() req: Request) {
    return this.auth.requestOtp(dto.channel, dto.destination, 'login', req.ip);
  }

  /** Verifies the code. New accounts must include displayName, ageConfirmed=true and acceptedPolicyVersion. */
  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('otp/verify')
  @HttpCode(200)
  verifyOtp(@Body() dto: OtpVerifyDto, @Req() req: Request) {
    return this.auth.verifyLogin(dto, req.ip, req.headers['user-agent']);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('mfa/verify')
  @HttpCode(200)
  verifyMfa(@Body() dto: MfaVerifyDto, @Req() req: Request) {
    return this.auth.verifyMfaLogin(dto.mfaToken, dto.code, dto.recoveryCode, req.ip, req.headers['user-agent']);
  }

  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentActor() actor: Actor) {
    await this.auth.revokeSession(actor.userId, actor.sessionId, 'logout');
  }

  @Post('logout-all')
  @HttpCode(200)
  async logoutAll(@CurrentActor() actor: Actor) {
    return { revoked: await this.auth.revokeAllSessions(actor.userId, actor.sessionId, 'logout_all') };
  }

  @Get('sessions')
  sessions(@CurrentActor() actor: Actor) {
    return this.auth.listSessions(actor);
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  async revoke(@CurrentActor() actor: Actor, @Param('id', ParseUUIDPipe) id: string) {
    await this.auth.revokeSession(actor.userId, id, 'user_revoked');
  }

  /** Step-up before sensitive changes: send a code to the user's own verified phone or email. */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('reauth/request')
  @HttpCode(200)
  reauthRequest(@CurrentActor() actor: Actor, @Body() dto: ReauthRequestDto, @Req() req: Request) {
    return this.auth.reauthRequest(actor, dto.channel, req.ip);
  }

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reauth/verify')
  @HttpCode(200)
  reauthVerify(@CurrentActor() actor: Actor, @Body() dto: ReauthVerifyDto) {
    return this.auth.reauthVerify(actor, dto.challengeId, dto.code, dto.totpCode);
  }

  /** Add or change phone/email. Requires recent re-authentication. */
  @RequireRecentAuth(10)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('contact/request')
  @HttpCode(200)
  contactRequest(@CurrentActor() actor: Actor, @Body() dto: ContactVerifyRequestDto, @Req() req: Request) {
    return this.auth.contactVerifyRequest(actor, dto.channel, dto.destination, req.ip);
  }

  @RequireRecentAuth(10)
  @Post('contact/verify')
  @HttpCode(200)
  contactVerify(@CurrentActor() actor: Actor, @Body() dto: ContactVerifyDto) {
    return this.auth.contactVerify(actor, dto.challengeId, dto.code);
  }

  @Get('mfa')
  mfaStatus(@CurrentActor() actor: Actor) {
    return this.auth.mfaStatus(actor.userId);
  }

  @RequireRecentAuth(10)
  @Post('mfa/totp/setup')
  totpSetup(@CurrentActor() actor: Actor) {
    return this.auth.totpSetup(actor);
  }

  @Post('mfa/totp/confirm')
  @HttpCode(200)
  totpConfirm(@CurrentActor() actor: Actor, @Body() dto: TotpConfirmDto) {
    return this.auth.totpConfirm(actor, dto.code);
  }

  @RequireRecentAuth(10)
  @Post('mfa/totp/disable')
  @HttpCode(200)
  totpDisable(@CurrentActor() actor: Actor, @Body() _dto: DisableTotpDto) {
    return this.auth.totpDisable(actor);
  }

  @RequireRecentAuth(10)
  @Post('mfa/recovery-codes')
  async regenerateRecoveryCodes(@CurrentActor() actor: Actor) {
    const status = await this.auth.mfaStatus(actor.userId);
    if (!status.totpEnabled) return { recoveryCodes: [] };
    return { recoveryCodes: await this.auth.issueRecoveryCodes(actor.userId) };
  }
}
