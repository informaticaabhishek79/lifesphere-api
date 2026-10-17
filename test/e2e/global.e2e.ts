import { auth, boot, Ctx, nextPhone, shutdown, signup } from '../helpers';

let ukSeq = 100000;
const ukMobile = () => `07400 ${String(ukSeq++).slice(-6)}`;

describe('Countries and local defaults', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await boot();
  });
  afterAll(() => shutdown(ctx));

  async function signupIn(country: string, phone: string, extra: Record<string, unknown> = {}) {
    const req = await ctx.http.post('/v1/auth/otp/request').send({ channel: 'sms', destination: phone, country }).expect(200);
    const v = await ctx.http
      .post('/v1/auth/otp/verify')
      .send({ challengeId: req.body.challengeId, code: req.body.devCode, displayName: `User ${country}`, ageConfirmed: true, acceptedPolicyVersion: '2026-10', ...extra })
      .expect(200);
    return { token: v.body.accessToken as string, id: v.body.user.id as string };
  }

  it('lists every country with calling code and defaults (public)', async () => {
    const r = await ctx.http.get('/v1/countries').expect(200);
    expect(r.body.length).toBeGreaterThan(190);
    expect(r.body.find((c: { code: string }) => c.code === 'GB')).toMatchObject({ dialCode: '+44', currency: 'GBP', emergency: '999' });
    expect(r.body.find((c: { code: string }) => c.code === 'IN')).toMatchObject({ dialCode: '+91', currency: 'INR', emergency: '112' });
  });

  it('reads a national number in the chosen country and derives the profile country', async () => {
    const u = await signupIn('GB', ukMobile());
    const me = await ctx.http.get('/v1/me').set(auth(u)).expect(200);
    expect(me.body.profile.country).toBe('GB');
    expect(me.body.profile.timezone).toBe('Europe/London');
    expect(me.body.profile.countryDefaults).toMatchObject({ currency: 'GBP', emergency: '999' });
  });

  it('rejects a national number that is not valid in the chosen country', async () => {
    const r = await ctx.http.post('/v1/auth/otp/request').send({ channel: 'sms', destination: '020 7946 0018', country: 'GB' }).expect(400);
    expect(r.body.code).toBe('invalid_destination');
  });

  it('keeps India as the default for numbers without a country (backward compatible)', async () => {
    const u = await signup(ctx, 'Indian user', nextPhone());
    const me = await ctx.http.get('/v1/me').set(auth(u)).expect(200);
    expect(me.body.profile.country).toBe('IN');
  });

  it('uses the device time zone and an explicit country when given', async () => {
    const u = await signupIn('US', '(212) 555-2368', { timezone: 'America/Los_Angeles', locale: 'es-US', country: 'US' });
    const me = await ctx.http.get('/v1/me').set(auth(u)).expect(200);
    expect(me.body.profile).toMatchObject({ country: 'US', timezone: 'America/Los_Angeles', locale: 'es-US' });
  });

  it('emergency number, budget currency and localities follow the country', async () => {
    const u = await signupIn('GB', ukMobile());
    const help = await ctx.http.get('/v1/help/preferences').set(auth(u)).expect(200);
    expect(help.body.emergencyNumber).toBe('999');
    expect(help.body.disclaimer).toContain('999');
    const b = await ctx.http.post('/v1/budgets').set(auth(u)).send({ month: '2026-10-01', category: 'Groceries', plannedAmount: 300 }).expect(201);
    expect(b.body.currency).toBe('GBP');
    const locs = await ctx.http.get('/v1/localities').set(auth(u)).expect(200);
    expect(locs.body.length).toBeGreaterThan(0);
    expect(locs.body.every((l: { country: string }) => l.country === 'GB')).toBe(true);
    const all = await ctx.http.get('/v1/localities?country=all').set(auth(u)).expect(200);
    expect(all.body.some((l: { country: string }) => l.country === 'IN')).toBe(true);
  });

  it('changing country in the profile changes local content', async () => {
    const u = await signupIn('GB', ukMobile());
    const gb = await ctx.http.get('/v1/consumer/official-channels').set(auth(u)).expect(200);
    expect(gb.body.some((c: { country: string | null }) => c.country === 'IN')).toBe(false);
    expect(gb.body.some((c: { country: string | null }) => c.country === 'GB')).toBe(true);
    await ctx.http.patch('/v1/me/profile').set(auth(u)).send({ country: 'IN' }).expect(200);
    const inCh = await ctx.http.get('/v1/consumer/official-channels').set(auth(u)).expect(200);
    expect(inCh.body.some((c: { country: string | null }) => c.country === 'IN')).toBe(true);
    const guides = await ctx.http.get('/v1/knowledge/articles').set(auth(u)).expect(200);
    expect(guides.body.items.every((a: { country: string | null }) => a.country === null || a.country === 'IN')).toBe(true);
    await ctx.http.patch('/v1/me/profile').set(auth(u)).send({ country: 'ZZ' }).expect(400);
  });

  it('invites read phone numbers in the inviter’s country', async () => {
    const a = await signupIn('GB', ukMobile());
    const r = await ctx.http.post('/v1/contacts/invitations').set(auth(a)).send({ phone: ukMobile(), label: 'Friend' }).expect(201);
    expect(r.body.id).toBeDefined();
  });
});
