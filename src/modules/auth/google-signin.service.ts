import { Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { decodeJwt, jwtVerify, SignJWT } from 'jose';
import { AuditService } from '../../common/audit.service';
import { countryFromTimezone, countryInfo, isCountryCode } from '../../common/countries';
import { CryptoService, normalizeEmail } from '../../common/crypto.service';
import { AppError, badRequest } from '../../common/errors';
import { isValidTimeZone } from '../../common/time';
import { Env, ENV } from '../../config/env';
import { Database, DB } from '../../db/db';
import { consentRecords, userIdentities, userPreferences, userProfiles, users } from '../../db/schema';
import { AuthService, LoginResult } from './auth.service';
import { GoogleStartDto, GoogleVerifyDto } from './auth.dto';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

interface StateClaims {
  nonce: string;
  verifier: string;
  redirectUri: string;
  ageConfirmed?: boolean;
  acceptedPolicyVersion?: string;
}

export type GoogleLoginResult = LoginResult | { status: 'signup_required'; email: string; name: string | null };

/**
 * "Continue with Google": OAuth 2.0 authorization code flow with PKCE, run by the server.
 * The web app keeps the signed state in an httpOnly cookie and sends it back with the code; nothing reaches
 * client-side JavaScript. The ID token comes straight from Google's token endpoint over TLS.
 */
@Injectable()
export class GoogleSignInService {
  private readonly logger = new Logger('GoogleSignIn');
  private readonly stateSecret: Uint8Array;

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {
    this.stateSecret = new TextEncoder().encode(`${env.JWT_SECRET}:google-state`);
  }

  get enabled() {
    return !!(this.env.GOOGLE_SIGNIN_CLIENT_ID && this.env.GOOGLE_SIGNIN_CLIENT_SECRET);
  }

  private requireEnabled() {
    if (!this.enabled) throw new AppError(404, 'google_signin_off', 'Sign-in with Google is not set up.');
  }

  /** The redirect must be our own web app's callback, so a code can never be sent elsewhere. */
  private redirectUri(uri?: string) {
    const expected = `${this.env.APP_BASE_URL.replace(/\/$/, '')}/auth/google/callback`;
    if (uri && uri !== expected) throw badRequest('Unexpected redirect address', 'invalid_redirect');
    return expected;
  }

  async start(dto: GoogleStartDto) {
    this.requireEnabled();
    const redirectUri = this.redirectUri(dto.redirectUri);
    const nonce = this.crypto.randomToken(24);
    const verifier = this.crypto.randomToken(48);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const claims: StateClaims = { nonce, verifier, redirectUri, ageConfirmed: dto.ageConfirmed, acceptedPolicyVersion: dto.acceptedPolicyVersion };
    const stateToken = await new SignJWT({ ...claims })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(this.stateSecret);
    const url = new URL(AUTH_URL);
    url.search = new URLSearchParams({
      client_id: this.env.GOOGLE_SIGNIN_CLIENT_ID!,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state: nonce,
      nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    return { url: url.toString(), stateToken };
  }

  async verify(dto: GoogleVerifyDto, ip?: string, userAgent?: string): Promise<GoogleLoginResult> {
    this.requireEnabled();
    const failed = (detail = 'Google sign-in did not complete. Please try again.') => new AppError(400, 'google_failed', detail);
    let state: StateClaims;
    try {
      state = (await jwtVerify(dto.stateToken, this.stateSecret)).payload as unknown as StateClaims;
    } catch {
      throw failed('This sign-in link has expired. Please try again.');
    }
    if (!this.crypto.safeEqualHex(Buffer.from(state.nonce).toString('hex'), Buffer.from(dto.state).toString('hex'))) throw failed();

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: dto.code,
        client_id: this.env.GOOGLE_SIGNIN_CLIENT_ID!,
        client_secret: this.env.GOOGLE_SIGNIN_CLIENT_SECRET!,
        redirect_uri: state.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: state.verifier,
      }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    const body = res ? ((await res.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string }) : {};
    if (!res?.ok || !body.id_token) {
      this.logger.warn(`Google token exchange failed: ${res?.status ?? 'network'} ${body.error ?? ''} ${body.error_description ?? ''}`);
      throw failed();
    }
    // Received directly from Google over TLS, so the claims can be read without fetching Google's keys;
    // audience, issuer, expiry and nonce are still checked.
    const c = decodeJwt(body.id_token) as { iss?: string; aud?: string; sub?: string; email?: string; email_verified?: boolean; name?: string; exp?: number; nonce?: string };
    if (!c.sub || c.aud !== this.env.GOOGLE_SIGNIN_CLIENT_ID || !ISSUERS.includes(c.iss ?? '') || (c.exp ?? 0) * 1000 < Date.now() || c.nonce !== state.nonce) throw failed();
    if (!c.email || !c.email_verified) throw failed('Your Google account has no verified email address.');
    const email = normalizeEmail(c.email);
    if (!email) throw failed('Your Google account has no usable email address.');
    const device = { deviceName: dto.deviceName, platform: dto.platform };

    // 1. Already linked.
    const [linked] = await this.db
      .select({ userId: userIdentities.userId })
      .from(userIdentities)
      .where(and(eq(userIdentities.provider, 'google'), eq(userIdentities.subject, c.sub)))
      .limit(1);
    let userId = linked?.userId;
    let isNew = false;

    // 2. An account with this verified email: Google has proven the person owns it, so link it.
    if (!userId) {
      const [byEmail] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
      if (byEmail) {
        userId = byEmail.id;
        await this.db.update(users).set({ emailVerifiedAt: new Date() }).where(and(eq(users.id, userId)));
      }
    }

    // 3. New person: the same consent as any sign-up.
    if (!userId) {
      if (!state.ageConfirmed || !state.acceptedPolicyVersion) return { status: 'signup_required', email, name: c.name ?? null };
      userId = await this.createUser(email, c.name ?? email.split('@')[0], state.acceptedPolicyVersion, dto);
      isNew = true;
    }

    const [u] = await this.db.select({ status: users.status }).from(users).where(eq(users.id, userId));
    if (u?.status === 'disabled') throw new AppError(403, 'account_disabled', 'This account has been disabled. Contact support.');
    if (u?.status === 'deleted') throw new AppError(403, 'account_deleted', 'This account has been deleted.');
    if (u?.status === 'pending_deletion') {
      await this.db.update(users).set({ status: 'active', deletionRequestedAt: null }).where(eq(users.id, userId));
      await this.audit.system({ action: 'account.deletion_cancelled_by_login', targetType: 'user', targetId: userId, subjectUserId: userId });
    }
    if (!linked) {
      await this.db.insert(userIdentities).values({ userId, provider: 'google', subject: c.sub }).onConflictDoNothing();
      await this.audit.system({ action: 'auth.identity_linked', targetType: 'user', targetId: userId, subjectUserId: userId, metadata: { provider: 'google' } });
    }
    await this.db.update(userIdentities).set({ lastUsedAt: new Date() }).where(and(eq(userIdentities.provider, 'google'), eq(userIdentities.subject, c.sub)));
    return this.auth.finishLogin(userId, ['google'], device, ip, userAgent, isNew);
  }

  private async createUser(email: string, name: string, policyVersion: string, dto: GoogleVerifyDto): Promise<string> {
    const now = new Date();
    const country = (dto.country && isCountryCode(dto.country) ? dto.country : null) ?? countryFromTimezone(dto.timezone);
    const timezone = dto.timezone && isValidTimeZone(dto.timezone) ? dto.timezone : countryInfo(country).timezone;
    return this.db.transaction(async (tx) => {
      const [u] = await tx.insert(users).values({ email, emailVerifiedAt: now, ageConfirmedAt: now }).returning({ id: users.id });
      await tx.insert(userProfiles).values({ userId: u.id, displayName: name.trim().slice(0, 80) || 'Friend', timezone, locale: dto.locale ?? 'en', country });
      await tx.insert(userPreferences).values({ userId: u.id });
      await tx.insert(consentRecords).values([
        { userId: u.id, purpose: 'terms', policyVersion },
        { userId: u.id, purpose: 'privacy_notice', policyVersion },
      ]);
      await this.audit.system({ action: 'account.created', targetType: 'user', targetId: u.id, subjectUserId: u.id, metadata: { channel: 'google' } }, tx);
      return u.id;
    });
  }
}
