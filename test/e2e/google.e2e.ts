import { SignJWT } from 'jose';
import { loadEnv } from '../../src/config/env';
import { auth, boot, Ctx, shutdown, signup } from '../helpers';

const CLIENT = 'test-client.apps.googleusercontent.com';
process.env.GOOGLE_SIGNIN_CLIENT_ID = CLIENT;
process.env.GOOGLE_SIGNIN_CLIENT_SECRET = 'test-secret';

describe('Continue with Google', () => {
  let ctx: Ctx;
  let redirectUri: string;
  const realFetch = global.fetch;
  let claims: Record<string, unknown> = {};
  let tokenRequests: URLSearchParams[] = [];

  beforeAll(async () => {
    // The environment may already be loaded (and cached) by the time this file runs.
    Object.assign(loadEnv(), { GOOGLE_SIGNIN_CLIENT_ID: CLIENT, GOOGLE_SIGNIN_CLIENT_SECRET: 'test-secret' });
    ctx = await boot();
    redirectUri = `${(process.env.APP_BASE_URL ?? 'http://localhost:3008').replace(/\/$/, '')}/auth/google/callback`;
    // Stand in for Google's token endpoint; everything else goes through untouched.
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) !== 'https://oauth2.googleapis.com/token') return realFetch(url as never, init);
      tokenRequests.push(new URLSearchParams(String(init?.body)));
      const idToken = await new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).sign(new TextEncoder().encode('google-signs-this'));
      return new Response(JSON.stringify({ id_token: idToken, access_token: 'x' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
  });
  afterAll(async () => {
    global.fetch = realFetch;
    await shutdown(ctx);
  });

  async function signIn(sub: string, email: string, consent: boolean, override: Record<string, unknown> = {}, expected = 200) {
    const start = await ctx.http.post('/v1/auth/google/start').send({ redirectUri, ...(consent ? { ageConfirmed: true, acceptedPolicyVersion: '2026-10' } : {}) }).expect(200);
    const url = new URL(start.body.url);
    const state = url.searchParams.get('state')!;
    claims = { iss: 'https://accounts.google.com', aud: CLIENT, sub, email, email_verified: true, name: 'Kamla Devi', exp: Math.floor(Date.now() / 1000) + 300, nonce: url.searchParams.get('nonce'), ...override };
    return ctx.http.post('/v1/auth/google/verify').send({ code: 'auth-code', state, stateToken: start.body.stateToken, deviceName: 'Test', platform: 'web', timezone: 'Asia/Kolkata' }).expect(expected);
  }

  it('sends people to Google with PKCE, only to our own callback, and says it is on', async () => {
    const r = await ctx.http.post('/v1/auth/google/start').send({ redirectUri }).expect(200);
    const url = new URL(r.body.url);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('client_id')).toBe(CLIENT);
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect((await ctx.http.post('/v1/auth/google/start').send({ redirectUri: 'https://evil.example/auth/google/callback' }).expect(400)).body.code).toBe('invalid_redirect');
    expect((await ctx.http.get('/v1/health/ready').expect(200)).body.integrations.googleSignIn).toBe('on');
  });

  it('a new person must accept the terms first; then the account is created with the verified email', async () => {
    const first = await signIn('g-111', 'Kamla@Example.com', false);
    expect(first.body).toMatchObject({ status: 'signup_required', email: 'kamla@example.com' });
    const ok = await signIn('g-111', 'kamla@example.com', true);
    expect(ok.body).toMatchObject({ status: 'authenticated', user: { isNew: true } });
    expect(tokenRequests.at(-1)!.get('code_verifier')).toBeTruthy();
    const me = (await ctx.http.get('/v1/me').set(auth({ token: ok.body.accessToken })).expect(200)).body;
    expect(me).toMatchObject({ email: 'kamla@example.com', emailVerified: true, profile: { displayName: 'Kamla Devi', timezone: 'Asia/Kolkata' } });
    // Next time: same account, no consent needed.
    const again = await signIn('g-111', 'kamla@example.com', false);
    expect(again.body).toMatchObject({ status: 'authenticated', user: { id: ok.body.user.id, isNew: false } });
  });

  it('links to an existing account with the same verified email', async () => {
    const u = await signup(ctx, 'Priya');
    await ctx.db.execute(`update users set email = 'priya@example.com', email_verified_at = now() where id = '${u.id}'` as never);
    const r = await signIn('g-222', 'priya@example.com', false);
    expect(r.body).toMatchObject({ status: 'authenticated', user: { id: u.id, isNew: false } });
  });

  it('refuses tampered or mismatched replies', async () => {
    const start = await ctx.http.post('/v1/auth/google/start').send({ redirectUri }).expect(200);
    expect((await ctx.http.post('/v1/auth/google/verify').send({ code: 'c', state: 'not-the-state', stateToken: start.body.stateToken }).expect(400)).body.code).toBe('google_failed');
    expect((await signIn('g-333', 'x@example.com', true, { aud: 'someone-elses-client' }, 400)).body.code).toBe('google_failed');
    expect((await signIn('g-333', 'x@example.com', true, { email_verified: false }, 400)).body.code).toBe('google_failed');
    expect((await ctx.http.post('/v1/auth/google/verify').send({ code: 'c', state: 's', stateToken: 'forged.token.value' }).expect(400)).body.code).toBe('google_failed');
  });
});
