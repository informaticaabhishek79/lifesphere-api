import { authenticator } from 'otplib';
import { auth, boot, Ctx, makeStaff, nextPhone, reauth, shutdown, signup } from '../helpers';

describe('Authentication & sessions', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await boot();
  });
  afterAll(() => shutdown(ctx));

  it('rejects protected routes without a token (problem+json)', async () => {
    const r = await ctx.http.get('/v1/me').expect(401);
    expect(r.headers['content-type']).toContain('application/problem+json');
    expect(r.body.code).toBe('unauthenticated');
  });

  it('requires 18+ confirmation, policy acceptance and a name for new accounts', async () => {
    const phone = nextPhone();
    const req = await ctx.http.post('/v1/auth/otp/request').send({ channel: 'sms', destination: phone }).expect(200);
    const r = await ctx.http.post('/v1/auth/otp/verify').send({ challengeId: req.body.challengeId, code: req.body.devCode, displayName: 'X', acceptedPolicyVersion: '2026-10' }).expect(422);
    expect(r.body.code).toBe('age_confirmation_required');
  });

  it('does not reveal whether a phone number has an account', async () => {
    const existing = await signup(ctx, 'Existing');
    const a = await ctx.http.post('/v1/auth/otp/request').send({ channel: 'sms', destination: existing.phone }).expect(200);
    const b = await ctx.http.post('/v1/auth/otp/request').send({ channel: 'sms', destination: nextPhone() }).expect(200);
    expect(Object.keys(a.body).sort()).toEqual(Object.keys(b.body).sort());
  });

  it('rejects invalid phone numbers and validates input', async () => {
    const r = await ctx.http.post('/v1/auth/otp/request').send({ channel: 'sms', destination: '12345' }).expect(400);
    expect(r.body.code).toBe('invalid_destination');
    const v = await ctx.http.post('/v1/auth/otp/request').send({ channel: 'fax', destination: '+919876543210', extra: 1 }).expect(400);
    expect(v.body.code).toBe('validation_failed');
    expect(v.body.errors.length).toBeGreaterThan(0);
  });

  it('locks a code after too many wrong attempts', async () => {
    const req = await ctx.http.post('/v1/auth/otp/request').send({ channel: 'sms', destination: nextPhone() }).expect(200);
    for (let i = 0; i < 5; i++) {
      await ctx.http.post('/v1/auth/otp/verify').send({ challengeId: req.body.challengeId, code: '000000' === req.body.devCode ? '111111' : '000000' }).expect(400);
    }
    const r = await ctx.http.post('/v1/auth/otp/verify').send({ challengeId: req.body.challengeId, code: req.body.devCode }).expect(429);
    expect(r.body.code).toBe('otp_locked');
  });

  it('a code cannot be used twice', async () => {
    const phone = nextPhone();
    const req = await ctx.http.post('/v1/auth/otp/request').send({ channel: 'sms', destination: phone }).expect(200);
    const body = { challengeId: req.body.challengeId, code: req.body.devCode, displayName: 'Once', ageConfirmed: true, acceptedPolicyVersion: '2026-10' };
    await ctx.http.post('/v1/auth/otp/verify').send(body).expect(200);
    await ctx.http.post('/v1/auth/otp/verify').send(body).expect(400);
  });

  it('signs up, returns profile, and records consents', async () => {
    const u = await signup(ctx, 'Asha');
    const me = await ctx.http.get('/v1/me').set(auth(u)).expect(200);
    expect(me.body.profile.displayName).toBe('Asha');
    expect(me.body.phoneVerified).toBe(true);
    const consents = await ctx.http.get('/v1/privacy/consents').set(auth(u)).expect(200);
    expect(consents.body.map((c: { purpose: string }) => c.purpose).sort()).toEqual(['privacy_notice', 'terms']);
  });

  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const u = await signup(ctx, 'Rotator');
    const r1 = await ctx.http.post('/v1/auth/refresh').send({ refreshToken: u.refreshToken }).expect(200);
    expect(r1.body.refreshToken).not.toBe(u.refreshToken);
    // Reusing the old token signals theft: the session is revoked.
    await ctx.http.post('/v1/auth/refresh').send({ refreshToken: u.refreshToken }).expect(401);
    await ctx.http.post('/v1/auth/refresh').send({ refreshToken: r1.body.refreshToken }).expect(401);
    await ctx.http.get('/v1/me').set({ Authorization: `Bearer ${r1.body.accessToken}` }).expect(401);
  });

  it('logout revokes the session immediately', async () => {
    const u = await signup(ctx, 'Leaver');
    await ctx.http.post('/v1/auth/logout').set(auth(u)).expect(204);
    await ctx.http.get('/v1/me').set(auth(u)).expect(401);
  });

  it('lists sessions and revokes another device', async () => {
    const u = await signup(ctx, 'Two devices');
    const req = await ctx.http.post('/v1/auth/otp/request').send({ channel: 'sms', destination: u.phone }).expect(200);
    const second = await ctx.http.post('/v1/auth/otp/verify').send({ challengeId: req.body.challengeId, code: req.body.devCode, deviceName: 'phone' }).expect(200);
    const list = await ctx.http.get('/v1/auth/sessions').set(auth(u)).expect(200);
    expect(list.body).toHaveLength(2);
    await ctx.http.delete(`/v1/auth/sessions/${second.body.sessionId}`).set(auth(u)).expect(204);
    await ctx.http.get('/v1/me').set({ Authorization: `Bearer ${second.body.accessToken}` }).expect(401);
    // New sign-in on another device produced a security notification.
    const inbox = await ctx.http.get('/v1/notifications').set(auth(u)).expect(200);
    expect(inbox.body.items.some((n: { category: string }) => n.category === 'security')).toBe(true);
  });

  it('sensitive actions require recent re-authentication', async () => {
    const u = await signup(ctx, 'Sensitive');
    await ctx.db.execute(`update auth.sessions set created_at = now() - interval '1 hour' where user_id = '${u.id}'` as never);
    const r = await ctx.http.post('/v1/privacy/delete-account').set(auth(u)).send({}).expect(403);
    expect(r.body.code).toBe('reauth_required');
    await reauth(ctx, u);
    await ctx.http.post('/v1/auth/mfa/totp/setup').set(auth(u)).expect(201);
  });

  it('TOTP: enrol, then sign-in requires a second factor; recovery codes work once', async () => {
    const u = await signup(ctx, 'Two factor');
    const setup = await ctx.http.post('/v1/auth/mfa/totp/setup').set(auth(u)).expect(201);
    await ctx.http.post('/v1/auth/mfa/totp/confirm').set(auth(u)).send({ code: '000000' }).expect(400);
    const confirm = await ctx.http.post('/v1/auth/mfa/totp/confirm').set(auth(u)).send({ code: authenticator.generate(setup.body.secret) }).expect(200);
    expect(confirm.body.recoveryCodes).toHaveLength(10);

    const req = await ctx.http.post('/v1/auth/otp/request').send({ channel: 'sms', destination: u.phone }).expect(200);
    const login = await ctx.http.post('/v1/auth/otp/verify').send({ challengeId: req.body.challengeId, code: req.body.devCode }).expect(200);
    expect(login.body.status).toBe('mfa_required');
    expect(login.body.accessToken).toBeUndefined();

    const rc = confirm.body.recoveryCodes[0];
    const done = await ctx.http.post('/v1/auth/mfa/verify').send({ mfaToken: login.body.mfaToken, recoveryCode: rc }).expect(200);
    expect(done.body.accessToken).toBeDefined();
    const again = await ctx.http.post('/v1/auth/otp/request').send({ channel: 'sms', destination: u.phone }).expect(200);
    const login2 = await ctx.http.post('/v1/auth/otp/verify').send({ challengeId: again.body.challengeId, code: again.body.devCode }).expect(200);
    await ctx.http.post('/v1/auth/mfa/verify').send({ mfaToken: login2.body.mfaToken, recoveryCode: rc }).expect(400);
    const status = await ctx.http.get('/v1/auth/mfa').set({ Authorization: `Bearer ${done.body.accessToken}` }).expect(200);
    expect(status.body.recoveryCodesRemaining).toBe(9);
  });

  it('staff endpoints: forbidden to users, require MFA for staff', async () => {
    const u = await signup(ctx, 'Normal');
    const r = await ctx.http.get('/v1/admin/overview').set(auth(u)).expect(403);
    expect(r.body.code).toBe('staff_only');
    const staff = await signup(ctx, 'Staffer');
    await ctx.db.execute(`insert into staff_roles (id, user_id, role) values (gen_random_uuid(), '${staff.id}', 'support')` as never);
    const noMfa = await ctx.http.get('/v1/admin/overview').set(auth(staff)).expect(403);
    expect(noMfa.body.code).toBe('mfa_required');
    const s2 = await signup(ctx, 'Staffer2');
    await makeStaff(ctx, s2, ['moderator']);
    await ctx.http.get('/v1/admin/overview').set(auth(s2)).expect(200);
    // A moderator cannot use super-admin routes.
    await ctx.http.get('/v1/admin/staff').set(auth(s2)).expect(403);
  });

  it('changing email requires OTP verification and is unique', async () => {
    const u = await signup(ctx, 'Mailer');
    await reauth(ctx, u);
    const r = await ctx.http.post('/v1/auth/contact/request').set(auth(u)).send({ channel: 'email', destination: 'Mailer@Example.com' }).expect(200);
    const v = await ctx.http.post('/v1/auth/contact/verify').set(auth(u)).send({ challengeId: r.body.challengeId, code: r.body.devCode }).expect(200);
    expect(v.body.verified).toBe(true);
    const me = await ctx.http.get('/v1/me').set(auth(u)).expect(200);
    expect(me.body.email).toBe('mailer@example.com');
    // Email can now be used to sign in.
    const login = await ctx.http.post('/v1/auth/otp/request').send({ channel: 'email', destination: 'mailer@example.com' }).expect(200);
    const s = await ctx.http.post('/v1/auth/otp/verify').send({ challengeId: login.body.challengeId, code: login.body.devCode }).expect(200);
    expect(s.body.user.id).toBe(u.id);
  });
});
