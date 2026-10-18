import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { jwtVerify, SignJWT } from 'jose';
import { authenticator } from 'otplib';
import { EmailAdapter, SmsAdapter } from '../../adapters/messaging';
import { Actor } from '../../common/auth-context';
import { AuditService } from '../../common/audit.service';
import { CryptoService, maskEmail, maskPhone, normalizeEmail, normalizePhone, phoneCountry } from '../../common/crypto.service';
import { countryFromTimezone, countryInfo, isCountryCode } from '../../common/countries';
import { AppError, badRequest, conflict, notFound } from '../../common/errors';
import { uuidv7 } from '../../common/ids';
import { TokenService } from '../../common/token.service';
import { isValidTimeZone } from '../../common/time';
import { Env, ENV } from '../../config/env';
import { Database, DB } from '../../db/db';
import {
  consentRecords,
  mfaFactors,
  otpChallenges,
  recoveryCodes,
  sessions,
  userPreferences,
  userProfiles,
  users,
} from '../../db/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { DeviceInfoDto, OtpVerifyDto } from './auth.dto';

authenticator.options = { window: 1, step: 30 };

type Purpose = 'login' | 'verify_email' | 'verify_phone' | 'reauth';

export interface TokenPair {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  sessionId: string;
}

export type LoginResult =
  | ({ status: 'authenticated'; user: { id: string; isNew: boolean } } & TokenPair)
  | { status: 'mfa_required'; mfaToken: string; mfaTokenExpiresAt: string };

@Injectable()
export class AuthService {
  private readonly mfaSecret: Uint8Array;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly crypto: CryptoService,
    private readonly tokens: TokenService,
    private readonly sms: SmsAdapter,
    private readonly email: EmailAdapter,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {
    this.mfaSecret = new TextEncoder().encode(`${env.JWT_SECRET}:mfa`);
  }

  // ------------------------------------------------------------------ OTP
  normalize(channel: 'sms' | 'email', destination: string, country?: string | null): string {
    const v = channel === 'sms' ? normalizePhone(destination, country ?? 'IN') : normalizeEmail(destination);
    if (!v) throw badRequest(channel === 'sms' ? 'Enter a valid mobile number' : 'Enter a valid email address', 'invalid_destination');
    return v;
  }

  async requestOtp(channel: 'sms' | 'email', destination: string, purpose: Purpose, ip: string | undefined, userId?: string, country?: string | null) {
    const dest = this.normalize(channel, destination, country);
    const destinationHash = this.crypto.hmac(`${channel}:${dest}`, 'otp-dest');
    const ipHash = ip ? this.crypto.hmac(ip, 'ip') : null;
    const hourAgo = new Date(Date.now() - 3600_000);

    const [{ n: perDest }] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(otpChallenges)
      .where(and(eq(otpChallenges.destinationHash, destinationHash), gt(otpChallenges.createdAt, hourAgo)));
    if (perDest >= this.env.OTP_MAX_PER_DESTINATION_HOUR) throw new AppError(HttpStatus.TOO_MANY_REQUESTS, 'otp_rate_limited', 'Too many codes requested. Try again in an hour.');
    if (ipHash) {
      const [{ n: perIp }] = await this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(otpChallenges)
        .where(and(eq(otpChallenges.ipHash, ipHash), gt(otpChallenges.createdAt, hourAgo)));
      if (perIp >= this.env.OTP_MAX_PER_IP_HOUR) throw new AppError(HttpStatus.TOO_MANY_REQUESTS, 'otp_rate_limited', 'Too many codes requested from this network.');
    }

    if (!userId && purpose === 'login') {
      const [existing] = await this.db
        .select({ id: users.id })
        .from(users)
        .where(channel === 'sms' ? eq(users.phoneE164, dest) : and(eq(users.email, dest), isNotNull(users.emailVerifiedAt)))
        .limit(1);
      userId = existing?.id;
    }

    const code = this.crypto.numericCode(6);
    const id = uuidv7();
    const expiresAt = new Date(Date.now() + this.env.OTP_TTL_SEC * 1000);
    await this.db.insert(otpChallenges).values({
      id,
      channel,
      purpose,
      destinationHash,
      destinationEnc: this.crypto.encrypt(dest),
      userId: userId ?? null,
      codeHash: this.crypto.hmac(`${id}:${code}`, 'otp'),
      expiresAt,
      ipHash,
    });

    // Same response whether or not an account exists, so numbers/emails cannot be enumerated.
    const send =
      channel === 'sms'
        ? await this.sms.send(dest, 'otp', { otp: code })
        : await this.email.send(dest, 'Your LifeSphere code', `Your LifeSphere verification code is ${code}. It expires in ${Math.round(this.env.OTP_TTL_SEC / 60)} minutes. Never share this code.`);
    if (send.status === 'failed') {
      throw new AppError(HttpStatus.SERVICE_UNAVAILABLE, 'otp_send_failed', 'We could not send the code right now. Please try again.');
    }
    return {
      challengeId: id,
      expiresAt: expiresAt.toISOString(),
      sentTo: channel === 'sms' ? maskPhone(dest) : maskEmail(dest),
      ...(this.env.OTP_DEV_ECHO && this.env.NODE_ENV !== 'production' ? { devCode: code } : {}),
    };
  }

  /** Validates and consumes a challenge. Returns the challenge and the stored destination hash. */
  private async consumeOtp(challengeId: string, code: string, purposes: Purpose[]) {
    const [ch] = await this.db.select().from(otpChallenges).where(eq(otpChallenges.id, challengeId)).limit(1);
    const invalid = new AppError(HttpStatus.BAD_REQUEST, 'otp_invalid', 'That code is not valid. Check it or request a new one.');
    if (!ch || !purposes.includes(ch.purpose) || ch.consumedAt || ch.expiresAt < new Date()) throw invalid;
    if (ch.attempts >= this.env.OTP_MAX_ATTEMPTS) {
      throw new AppError(HttpStatus.TOO_MANY_REQUESTS, 'otp_locked', 'Too many wrong attempts. Request a new code.');
    }
    const fixed = this.env.NODE_ENV !== 'production' && this.env.OTP_DEV_FIXED_CODE && code === this.env.OTP_DEV_FIXED_CODE;
    const ok = fixed || this.crypto.safeEqualHex(this.crypto.hmac(`${ch.id}:${code}`, 'otp'), ch.codeHash);
    if (!ok) {
      await this.db.update(otpChallenges).set({ attempts: sql`${otpChallenges.attempts} + 1` }).where(eq(otpChallenges.id, ch.id));
      throw invalid;
    }
    const consumed = await this.db
      .update(otpChallenges)
      .set({ consumedAt: new Date() })
      .where(and(eq(otpChallenges.id, ch.id), isNull(otpChallenges.consumedAt)))
      .returning({ id: otpChallenges.id });
    if (!consumed.length) throw invalid;
    return ch;
  }

  // ------------------------------------------------------------------ login
  async verifyLogin(dto: OtpVerifyDto, ip: string | undefined, userAgent: string | undefined): Promise<LoginResult> {
    const ch = await this.consumeOtp(dto.challengeId, dto.code, ['login']);
    const [user] = ch.userId
      ? await this.db.select({ id: users.id, status: users.status }).from(users).where(eq(users.id, ch.userId)).limit(1)
      : [];

    let userId: string;
    let isNew = false;
    if (user) {
      if (user.status === 'disabled') throw new AppError(403, 'account_disabled', 'This account has been disabled. Contact support.');
      if (user.status === 'deleted') throw new AppError(403, 'account_deleted', 'This account has been deleted.');
      userId = user.id;
      // Logging in during the deletion grace period cancels the deletion.
      if (user.status === 'pending_deletion') {
        await this.db.update(users).set({ status: 'active', deletionRequestedAt: null }).where(eq(users.id, userId));
        await this.audit.system({ action: 'account.deletion_cancelled_by_login', targetType: 'user', targetId: userId, subjectUserId: userId });
      }
    } else {
      if (!dto.ageConfirmed) throw new AppError(422, 'age_confirmation_required', 'You must confirm you are 18 or older to create an account.');
      if (!dto.acceptedPolicyVersion)
        throw new AppError(422, 'policy_acceptance_required', 'Please accept the Terms and Privacy Notice to create an account.');
      if (!dto.displayName?.trim()) throw new AppError(422, 'display_name_required', 'Please tell us what to call you.');
      userId = await this.createUserFromChallenge(ch, dto);
      isNew = true;
    }

    return this.finishLogin(userId, [ch.channel === 'sms' ? 'otp_sms' : 'otp_email'], { deviceName: dto.deviceName, platform: dto.platform }, ip, userAgent, isNew);
  }

  /** After the first factor: ask for the second factor if the person set one up, otherwise open a session. */
  async finishLogin(userId: string, amr: string[], device: DeviceInfoDto, ip: string | undefined, userAgent: string | undefined, isNew: boolean): Promise<LoginResult> {
    const [factor] = await this.db
      .select({ id: mfaFactors.id })
      .from(mfaFactors)
      .where(and(eq(mfaFactors.userId, userId), isNotNull(mfaFactors.confirmedAt)))
      .limit(1);
    if (factor) {
      const exp = new Date(Date.now() + 5 * 60_000);
      const mfaToken = await new SignJWT({ amr, deviceName: device.deviceName ?? null, platform: device.platform ?? null, purpose: 'mfa' })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(userId)
        .setIssuedAt()
        .setExpirationTime(Math.floor(exp.getTime() / 1000))
        .sign(this.mfaSecret);
      return { status: 'mfa_required', mfaToken, mfaTokenExpiresAt: exp.toISOString() };
    }
    const pair = await this.createSession(userId, amr, device, ip, userAgent, false);
    return { status: 'authenticated', user: { id: userId, isNew }, ...pair };
  }

  private async createUserFromChallenge(ch: { channel: 'sms' | 'email'; destinationEnc: string }, dto: OtpVerifyDto): Promise<string> {
    const dest = this.crypto.decrypt(ch.destinationEnc);
    const now = new Date();
    const country =
      (dto.country && isCountryCode(dto.country) ? dto.country : null) ??
      (ch.channel === 'sms' ? [phoneCountry(dest)].find(isCountryCode) ?? null : null) ??
      countryFromTimezone(dto.timezone);
    const timezone = dto.timezone && isValidTimeZone(dto.timezone) ? dto.timezone : countryInfo(country).timezone;
    return this.db.transaction(async (tx) => {
      const clash = await tx
        .select({ id: users.id })
        .from(users)
        .where(ch.channel === 'sms' ? eq(users.phoneE164, dest) : eq(users.email, dest))
        .limit(1);
      if (clash.length) throw conflict('An account already uses this contact. Sign in with your other verified contact.', 'contact_in_use');
      const [u] = await tx
        .insert(users)
        .values({
          phoneE164: ch.channel === 'sms' ? dest : null,
          phoneVerifiedAt: ch.channel === 'sms' ? now : null,
          email: ch.channel === 'email' ? dest : null,
          emailVerifiedAt: ch.channel === 'email' ? now : null,
          ageConfirmedAt: now,
        })
        .returning({ id: users.id });
      await tx.insert(userProfiles).values({
        userId: u.id,
        displayName: dto.displayName!.trim().slice(0, 80),
        timezone,
        locale: dto.locale ?? 'en',
        country,
      });
      await tx.insert(userPreferences).values({ userId: u.id });
      await tx.insert(consentRecords).values([
        { userId: u.id, purpose: 'terms', policyVersion: dto.acceptedPolicyVersion! },
        { userId: u.id, purpose: 'privacy_notice', policyVersion: dto.acceptedPolicyVersion! },
      ]);
      await this.audit.system({ action: 'account.created', targetType: 'user', targetId: u.id, subjectUserId: u.id, metadata: { channel: ch.channel } }, tx);
      return u.id;
    });
  }

  async createSession(
    userId: string,
    amr: string[],
    device: DeviceInfoDto,
    ip: string | undefined,
    userAgent: string | undefined,
    mfaVerified: boolean,
  ): Promise<TokenPair> {
    const id = uuidv7();
    const refreshToken = this.crypto.randomToken(32);
    const refreshExpires = new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
    const existing = await this.db
      .select({ id: sessions.id })
      .from(sessions)
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
      .limit(1);
    await this.db.insert(sessions).values({
      id,
      userId,
      familyId: id,
      refreshTokenHash: this.crypto.hmac(refreshToken, 'refresh'),
      deviceName: device.deviceName?.slice(0, 120),
      platform: device.platform,
      userAgent: userAgent?.slice(0, 300),
      ipHash: ip ? this.crypto.hmac(ip, 'ip') : null,
      amr,
      mfaVerifiedAt: mfaVerified ? new Date() : null,
      expiresAt: refreshExpires,
    });
    await this.audit.system({ action: 'auth.session_created', targetType: 'session', targetId: id, subjectUserId: userId, metadata: { mfa: mfaVerified } });
    if (existing.length) {
      await this.notifications.notify({
        userId,
        category: 'security',
        template: 'new_sign_in',
        title: 'New sign-in to your account',
        body: `Signed in on ${device.deviceName ?? 'a new device'}. If this wasn't you, sign out other sessions in Settings.`,
        data: { type: 'session', id },
        channels: ['push', 'email'],
      });
    }
    const access = await this.tokens.signAccess({ sub: userId, sid: id, amr });
    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken,
      refreshTokenExpiresAt: refreshExpires.toISOString(),
      sessionId: id,
    };
  }

  async verifyMfaLogin(mfaToken: string, code: string | undefined, recoveryCode: string | undefined, ip?: string, userAgent?: string) {
    let payload: { sub?: string; amr?: string[]; deviceName?: string | null; platform?: 'web' | 'android' | 'ios' | null; purpose?: string };
    try {
      payload = (await jwtVerify(mfaToken, this.mfaSecret, { algorithms: ['HS256'] })).payload as typeof payload;
    } catch {
      throw new AppError(401, 'mfa_token_invalid', 'Your sign-in attempt expired. Please start again.');
    }
    if (payload.purpose !== 'mfa' || !payload.sub) throw new AppError(401, 'mfa_token_invalid', 'Invalid sign-in attempt.');
    const method = await this.checkSecondFactor(payload.sub, code, recoveryCode);
    const pair = await this.createSession(
      payload.sub,
      [...(payload.amr ?? []), method],
      { deviceName: payload.deviceName ?? undefined, platform: payload.platform ?? undefined },
      ip,
      userAgent,
      true,
    );
    return { status: 'authenticated' as const, user: { id: payload.sub, isNew: false }, ...pair };
  }

  /** Verifies a TOTP or recovery code. Returns the amr value used. */
  async checkSecondFactor(userId: string, code?: string, recoveryCode?: string): Promise<'totp' | 'recovery_code'> {
    const bad = new AppError(400, 'mfa_code_invalid', 'That code is not valid.');
    if (code) {
      const [factor] = await this.db
        .select()
        .from(mfaFactors)
        .where(and(eq(mfaFactors.userId, userId), isNotNull(mfaFactors.confirmedAt)))
        .limit(1);
      if (!factor) throw bad;
      const secret = this.crypto.decrypt(factor.secretEncrypted);
      const delta = authenticator.checkDelta(code, secret);
      if (delta === null) throw bad;
      const step = Math.floor(Date.now() / 30_000) + delta;
      if (factor.lastUsedStep !== null && step <= factor.lastUsedStep) throw bad; // replay
      await this.db.update(mfaFactors).set({ lastUsedStep: step }).where(eq(mfaFactors.id, factor.id));
      return 'totp';
    }
    if (recoveryCode) {
      const hash = this.crypto.hmac(recoveryCode.replace(/[\s-]/g, '').toLowerCase(), 'recovery');
      const used = await this.db
        .update(recoveryCodes)
        .set({ usedAt: new Date() })
        .where(and(eq(recoveryCodes.userId, userId), eq(recoveryCodes.codeHash, hash), isNull(recoveryCodes.usedAt)))
        .returning({ id: recoveryCodes.id });
      if (!used.length) throw bad;
      await this.audit.system({ action: 'auth.recovery_code_used', targetType: 'user', targetId: userId, subjectUserId: userId });
      return 'recovery_code';
    }
    throw badRequest('Provide an authenticator code or a recovery code', 'mfa_code_required');
  }

  // ------------------------------------------------------------------ refresh / logout
  async refresh(refreshToken: string): Promise<TokenPair> {
    const hash = this.crypto.hmac(refreshToken, 'refresh');
    const [s] = await this.db.select().from(sessions).where(eq(sessions.refreshTokenHash, hash)).limit(1);
    if (!s) {
      // Reuse of an already-rotated token: likely stolen. Revoke the whole family.
      const [reused] = await this.db.select().from(sessions).where(eq(sessions.previousTokenHash, hash)).limit(1);
      if (reused) {
        await this.db
          .update(sessions)
          .set({ revokedAt: new Date(), revokedReason: 'refresh_reuse' })
          .where(and(eq(sessions.familyId, reused.familyId), isNull(sessions.revokedAt)));
        await this.audit.system({ action: 'auth.refresh_reuse_detected', targetType: 'session', targetId: reused.id, subjectUserId: reused.userId });
        await this.notifications.notify({
          userId: reused.userId,
          category: 'security',
          template: 'session_revoked_reuse',
          title: 'We signed you out for safety',
          body: 'A sign-in token was reused, which can mean it was copied. Please sign in again.',
          channels: ['push', 'email'],
        });
      }
      throw new AppError(401, 'refresh_invalid', 'Please sign in again.');
    }
    if (s.revokedAt || s.expiresAt < new Date()) throw new AppError(401, 'refresh_invalid', 'Please sign in again.');
    const [u] = await this.db.select({ status: users.status }).from(users).where(eq(users.id, s.userId)).limit(1);
    if (!u || !['active', 'pending_deletion'].includes(u.status)) throw new AppError(401, 'refresh_invalid', 'Please sign in again.');

    const next = this.crypto.randomToken(32);
    const nextHash = this.crypto.hmac(next, 'refresh');
    const rotated = await this.db
      .update(sessions)
      .set({ refreshTokenHash: nextHash, previousTokenHash: hash, lastUsedAt: new Date() })
      .where(and(eq(sessions.id, s.id), eq(sessions.refreshTokenHash, hash)))
      .returning({ id: sessions.id });
    if (!rotated.length) throw new AppError(401, 'refresh_invalid', 'Please sign in again.');
    const access = await this.tokens.signAccess({ sub: s.userId, sid: s.id, amr: s.amr });
    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken: next,
      refreshTokenExpiresAt: s.expiresAt.toISOString(),
      sessionId: s.id,
    };
  }

  async revokeSession(userId: string, sessionId: string, reason: string) {
    const res = await this.db
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(sessions.id, sessionId), eq(sessions.userId, userId), isNull(sessions.revokedAt)))
      .returning({ id: sessions.id });
    if (!res.length) throw notFound('Session');
    await this.audit.system({ action: 'auth.session_revoked', targetType: 'session', targetId: sessionId, subjectUserId: userId, metadata: { reason } });
  }

  async revokeAllSessions(userId: string, exceptSessionId: string | null, reason: string) {
    const res = await this.db
      .update(sessions)
      .set({ revokedAt: new Date(), revokedReason: reason })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), exceptSessionId ? ne(sessions.id, exceptSessionId) : undefined))
      .returning({ id: sessions.id });
    await this.audit.system({ action: 'auth.sessions_revoked_all', targetType: 'user', targetId: userId, subjectUserId: userId, metadata: { count: res.length, reason } });
    return res.length;
  }

  async listSessions(actor: Actor) {
    const rows = await this.db
      .select({
        id: sessions.id,
        deviceName: sessions.deviceName,
        platform: sessions.platform,
        createdAt: sessions.createdAt,
        lastUsedAt: sessions.lastUsedAt,
        expiresAt: sessions.expiresAt,
        mfaVerified: sql<boolean>`${sessions.mfaVerifiedAt} is not null`,
      })
      .from(sessions)
      .where(and(eq(sessions.userId, actor.userId), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
      .orderBy(desc(sessions.lastUsedAt));
    return rows.map((r) => ({ ...r, current: r.id === actor.sessionId }));
  }

  // ------------------------------------------------------------------ re-authentication
  async reauthRequest(actor: Actor, channel: 'sms' | 'email', ip?: string) {
    const [u] = await this.db.select().from(users).where(eq(users.id, actor.userId)).limit(1);
    const dest = channel === 'sms' ? (u?.phoneVerifiedAt ? u.phoneE164 : null) : u?.emailVerifiedAt ? u.email : null;
    if (!dest) throw badRequest(`No verified ${channel === 'sms' ? 'phone number' : 'email'} on your account`, 'no_verified_contact');
    return this.requestOtp(channel, dest, 'reauth', ip, actor.userId);
  }

  async reauthVerify(actor: Actor, challengeId?: string, code?: string, totpCode?: string) {
    let method: string;
    if (totpCode) {
      method = await this.checkSecondFactor(actor.userId, totpCode);
    } else {
      if (!challengeId || !code) throw badRequest('Provide challengeId and code, or totpCode', 'reauth_input_required');
      const ch = await this.consumeOtp(challengeId, code, ['reauth']);
      if (ch.userId !== actor.userId) throw new AppError(400, 'otp_invalid', 'That code is not valid.');
      method = ch.channel === 'sms' ? 'otp_sms' : 'otp_email';
    }
    const now = new Date();
    await this.db
      .update(sessions)
      .set({ reauthAt: now, ...(method === 'totp' ? { mfaVerifiedAt: now } : {}) })
      .where(eq(sessions.id, actor.sessionId));
    return { reauthenticatedAt: now.toISOString(), validForMinutes: 10 };
  }

  // ------------------------------------------------------------------ contact verification (add/change phone or email)
  async contactVerifyRequest(actor: Actor, channel: 'sms' | 'email', destination: string, ip?: string, country?: string) {
    const [prof] = await this.db.select({ country: userProfiles.country }).from(userProfiles).where(eq(userProfiles.userId, actor.userId));
    const dest = this.normalize(channel, destination, country ?? prof?.country);
    const taken = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(channel === 'sms' ? eq(users.phoneE164, dest) : eq(users.email, dest), ne(users.id, actor.userId)))
      .limit(1);
    // Not revealed until the code is verified (prevents enumeration); the verify step reports the conflict.
    void taken;
    return this.requestOtp(channel, dest, channel === 'sms' ? 'verify_phone' : 'verify_email', ip, actor.userId);
  }

  async contactVerify(actor: Actor, challengeId: string, code: string) {
    const ch = await this.consumeOtp(challengeId, code, ['verify_email', 'verify_phone']);
    if (ch.userId !== actor.userId) throw new AppError(400, 'otp_invalid', 'That code is not valid.');
    const dest = this.crypto.decrypt(ch.destinationEnc);
    const isPhone = ch.purpose === 'verify_phone';
    const [taken] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(isPhone ? eq(users.phoneE164, dest) : eq(users.email, dest), ne(users.id, actor.userId)))
      .limit(1);
    if (taken) throw conflict('This contact is already linked to another account.', 'contact_in_use');
    const now = new Date();
    await this.db
      .update(users)
      .set(isPhone ? { phoneE164: dest, phoneVerifiedAt: now } : { email: dest, emailVerifiedAt: now })
      .where(eq(users.id, actor.userId));
    await this.audit.record(actor, {
      action: isPhone ? 'account.phone_changed' : 'account.email_changed',
      targetType: 'user',
      targetId: actor.userId,
      subjectUserId: actor.userId,
    });
    await this.notifications.notify({
      userId: actor.userId,
      category: 'security',
      template: 'contact_changed',
      title: isPhone ? 'Your mobile number was updated' : 'Your email address was updated',
      body: "If you didn't make this change, contact support immediately.",
      channels: ['push', 'email'],
    });
    return isPhone ? { phone: maskPhone(dest), verified: true } : { email: maskEmail(dest), verified: true };
  }

  // ------------------------------------------------------------------ TOTP MFA
  async totpSetup(actor: Actor) {
    const [existing] = await this.db
      .select()
      .from(mfaFactors)
      .where(and(eq(mfaFactors.userId, actor.userId), isNotNull(mfaFactors.confirmedAt)))
      .limit(1);
    if (existing) throw conflict('Two-factor authentication is already enabled', 'mfa_already_enabled');
    await this.db.delete(mfaFactors).where(and(eq(mfaFactors.userId, actor.userId), isNull(mfaFactors.confirmedAt)));
    const secret = authenticator.generateSecret(20);
    const [u] = await this.db.select({ phone: users.phoneE164, email: users.email }).from(users).where(eq(users.id, actor.userId));
    const label = u?.email ?? (u?.phone ? maskPhone(u.phone) : 'account');
    await this.db.insert(mfaFactors).values({ userId: actor.userId, secretEncrypted: this.crypto.encrypt(secret) });
    return { secret, otpauthUrl: authenticator.keyuri(label, 'LifeSphere', secret) };
  }

  async totpConfirm(actor: Actor, code: string) {
    const [factor] = await this.db
      .select()
      .from(mfaFactors)
      .where(and(eq(mfaFactors.userId, actor.userId), isNull(mfaFactors.confirmedAt)))
      .orderBy(desc(mfaFactors.createdAt))
      .limit(1);
    if (!factor) throw badRequest('Start two-factor setup first', 'mfa_setup_required');
    const secret = this.crypto.decrypt(factor.secretEncrypted);
    const delta = authenticator.checkDelta(code, secret);
    if (delta === null) throw new AppError(400, 'mfa_code_invalid', 'That code is not valid.');
    const now = new Date();
    await this.db
      .update(mfaFactors)
      .set({ confirmedAt: now, lastUsedStep: Math.floor(Date.now() / 30_000) + delta })
      .where(eq(mfaFactors.id, factor.id));
    await this.db.update(sessions).set({ mfaVerifiedAt: now, amr: sql`array_append(${sessions.amr}, 'totp')` }).where(eq(sessions.id, actor.sessionId));
    const codes = await this.issueRecoveryCodes(actor.userId);
    await this.audit.record(actor, { action: 'auth.mfa_enabled', targetType: 'user', targetId: actor.userId, subjectUserId: actor.userId });
    await this.notifications.notify({
      userId: actor.userId,
      category: 'security',
      template: 'mfa_enabled',
      title: 'Two-factor authentication turned on',
      channels: ['email'],
    });
    return { enabled: true, recoveryCodes: codes };
  }

  async issueRecoveryCodes(userId: string): Promise<string[]> {
    await this.db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
    const codes = Array.from({ length: 10 }, () => {
      const raw = this.crypto.randomToken(8).replace(/[^a-zA-Z0-9]/g, '').toLowerCase().slice(0, 10).padEnd(10, '7');
      return `${raw.slice(0, 5)}-${raw.slice(5)}`;
    });
    await this.db
      .insert(recoveryCodes)
      .values(codes.map((c) => ({ userId, codeHash: this.crypto.hmac(c.replace('-', ''), 'recovery') })));
    return codes;
  }

  async totpDisable(actor: Actor) {
    const res = await this.db.delete(mfaFactors).where(eq(mfaFactors.userId, actor.userId)).returning({ id: mfaFactors.id });
    await this.db.delete(recoveryCodes).where(eq(recoveryCodes.userId, actor.userId));
    if (!res.length) throw notFound('Two-factor method');
    await this.audit.record(actor, { action: 'auth.mfa_disabled', targetType: 'user', targetId: actor.userId, subjectUserId: actor.userId });
    await this.notifications.notify({
      userId: actor.userId,
      category: 'security',
      template: 'mfa_disabled',
      title: 'Two-factor authentication turned off',
      body: "If you didn't do this, sign out all sessions and contact support.",
      channels: ['push', 'email'],
    });
    return { enabled: false };
  }

  async mfaStatus(userId: string) {
    const [factor] = await this.db
      .select({ confirmedAt: mfaFactors.confirmedAt })
      .from(mfaFactors)
      .where(and(eq(mfaFactors.userId, userId), isNotNull(mfaFactors.confirmedAt)))
      .limit(1);
    const [{ n }] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(recoveryCodes)
      .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)));
    return { totpEnabled: !!factor, enabledAt: factor?.confirmedAt ?? null, recoveryCodesRemaining: n };
  }
}
