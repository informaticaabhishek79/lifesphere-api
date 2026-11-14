import { sql } from 'drizzle-orm';
import { simulatedOutbox } from '../../src/adapters/messaging';
import { CheckinsService, words } from '../../src/modules/checkins/checkins.service';
import { ContactsService } from '../../src/modules/contacts/contacts.service';
import { auth, boot, connect, Ctx, expireCooloff, shutdown, signup, TestUser } from '../helpers';

describe('Parent care: a son invites his mother, she shares back, sets up her day, he sees how she is', () => {
  let ctx: Ctx;
  let son: TestUser;
  let mother: TestUser;
  let stranger: TestUser;
  let token: string;

  beforeAll(async () => {
    ctx = await boot();
    son = await signup(ctx, 'Arjun');
    mother = await signup(ctx, 'Kamla');
    stranger = await signup(ctx, 'Stranger');
  });
  afterAll(() => shutdown(ctx));

  it('caregiver mode focuses the home and keeps family care on', async () => {
    const r = await ctx.http.post('/v1/care/mode').set(auth(son)).send({ mode: 'caregiver' }).expect(200);
    expect(r.body.homeMode).toBe('caregiver');
    expect(r.body.disabledFeatures).toEqual(expect.arrayContaining(['community', 'consumer', 'services', 'agents']));
    expect(r.body.disabledFeatures).not.toContain('familycare');
    // Back to everything: what focus hid comes back.
    const back = await ctx.http.post('/v1/care/mode').set(auth(son)).send({ mode: 'standard' }).expect(200);
    expect(back.body.disabledFeatures).toEqual([]);
    await ctx.http.post('/v1/care/mode').set(auth(son)).send({ mode: 'caregiver' }).expect(200);
  });

  it('the invitation asks her to share back; she chooses what, with the usual safeguards', async () => {
    const inv = await ctx.http
      .post('/v1/contacts/invitations')
      .set(auth(son))
      .send({ phone: mother.phone, label: 'Maa', requestedScopes: ['checkins.view', 'checkins.alerts', 'help.alerts', 'calendar.view'] })
      .expect(201);
    expect(inv.body.requestedScopes).toHaveLength(4);
    token = new URL(inv.body.inviteLink.replace('#token=', '?token=')).searchParams.get('token')!;
    const waiting = await ctx.http.get('/v1/care/people').set(auth(son)).expect(200);
    expect(waiting.body.invitations).toHaveLength(1);
    expect(waiting.body.people).toEqual([]);

    const preview = await ctx.http.post('/v1/contacts/invitations/preview').set(auth(mother)).send({ token }).expect(200);
    expect(preview.body.requestedScopes.map((s: { scope: string }) => s.scope)).toEqual(['checkins.view', 'checkins.alerts', 'help.alerts', 'calendar.view']);
    // Only what was asked for.
    expect((await ctx.http.post('/v1/contacts/invitations/accept').set(auth(mother)).send({ token, shareBack: ['help.location'] }).expect(400)).body.code).toBe('scope_not_requested');
    // An old session must confirm first, and nothing is accepted until then.
    await ctx.db.execute(sql`update auth.sessions set created_at = now() - interval '1 hour' where user_id = ${mother.id}`);
    expect((await ctx.http.post('/v1/contacts/invitations/accept').set(auth(mother)).send({ token, shareBack: ['checkins.view'] }).expect(403)).body.code).toBe('reauth_required');
    expect((await ctx.http.post('/v1/contacts/invitations/preview').set(auth(mother)).send({ token }).expect(200)).body.id).toBe(inv.body.id);
    await ctx.db.execute(sql`update auth.sessions set created_at = now() where user_id = ${mother.id}`);

    const before = simulatedOutbox.length;
    // She shares check-ins and help alerts, but not her calendar.
    const ok = await ctx.http.post('/v1/contacts/invitations/accept').set(auth(mother)).send({ token, shareBack: ['checkins.view', 'checkins.alerts', 'help.alerts'] }).expect(200);
    expect(ok.body.sharedBack).toEqual(['checkins.view', 'checkins.alerts', 'help.alerts']);
    expect(simulatedOutbox.slice(before).some((m) => m.channel === 'sms' && m.to === mother.phone)).toBe(true);
    const starting = await ctx.http.get('/v1/care/people').set(auth(son)).expect(200);
    expect(starting.body.invitations).toEqual([]);
    expect(starting.body.people[0]).toMatchObject({ userId: mother.id, label: 'Maa', status: 'starting', today: null });
    await expireCooloff(ctx);
    await ctx.app.get(ContactsService).activateDueGrants();
  });

  it('she sets up her day in one step', async () => {
    const r = await ctx.http
      .post('/v1/care/setup')
      .set(auth(mother))
      .send({
        checkInTime: '10:00',
        checkInLabel: 'रोज़ का हाल',
        alertContactIds: [son.id],
        consentToAlertContacts: true,
        medicines: [{ name: 'BP tablet', times: ['08:00', '20:00'] }],
        medicineAlerts: true,
        primaryCallContactId: son.id,
        largerText: true,
      })
      .expect(200);
    expect(r.body.circle).toEqual([expect.objectContaining({ userId: son.id, displayName: 'Arjun' })]);
    expect(r.body.callTargets.map((c: { label?: string; number?: string }) => JSON.stringify(c)).join()).toContain('Arjun');
    expect(r.body.activeSchedules).toBe(3);
    const schedules = (await ctx.http.get('/v1/check-ins/schedules').set(auth(mother)).expect(200)).body;
    expect(schedules.map((s: { label: string; purpose: string; timeLocal: string }) => `${s.purpose}:${s.label}:${s.timeLocal}`).sort()).toEqual(['medicine:BP tablet:08:00', 'medicine:BP tablet:20:00', 'wellbeing:रोज़ का हाल:10:00']);
    expect(schedules.every((s: { escalationContacts: { userId: string }[] }) => s.escalationContacts[0]?.userId === son.id)).toBe(true);
    const me = (await ctx.http.get('/v1/me').set(auth(mother)).expect(200)).body;
    expect(me.profile.seniorMode).toBe(true);
    expect(me.preferences.homeMode).toBe('cared_for');
    expect(me.preferences.disabledFeatures).toContain('household');
    // Running setup again moves the daily check-in instead of adding a second one.
    await ctx.http.post('/v1/care/setup').set(auth(mother)).send({ checkInTime: '11:00', alertContactIds: [son.id] }).expect(200);
    const again = (await ctx.http.get('/v1/check-ins/schedules').set(auth(mother)).expect(200)).body.filter((s: { purpose: string }) => s.purpose === 'wellbeing');
    expect(again.map((s: { timeLocal: string }) => s.timeLocal)).toEqual(['11:00']);
    // She can only name contacts who agreed to receive her alerts.
    expect((await ctx.http.post('/v1/care/setup').set(auth(mother)).send({ checkInTime: '11:00', alertContactIds: [stranger.id] }).expect(422)).body.code).toBe('grant_required');
  });

  it("medicine reminders: 'I'm OK' does not tick a medicine; a missed one tells her son without naming it by SMS", async () => {
    const svc = ctx.app.get(CheckinsService);
    await ctx.db.execute(sql`update check_in_schedules set next_due_at = now() - interval '5 minutes' where user_id = ${mother.id} and purpose = 'medicine' and time_local = '08:00'`);
    await svc.tick();
    const today = (await ctx.http.get('/v1/care/today').set(auth(mother)).expect(200)).body;
    const med = today.today.find((i: { purpose: string; upcoming: boolean }) => i.purpose === 'medicine' && !i.upcoming);
    expect(med).toMatchObject({ label: 'BP tablet', state: 'pending' });

    const ok = await ctx.http.post('/v1/check-ins/now').set(auth(mother)).send({}).expect(200);
    expect(ok.body.status).toBe('no_open_check_in');

    // Not confirmed: reminder after 20 minutes, then her son is told after an hour.
    await ctx.db.execute(sql`update check_in_events set due_at = now() - interval '25 minutes' where id = ${med.id}`);
    await svc.tick();
    await ctx.db.execute(sql`update check_in_events set reminded_at = now() - interval '41 minutes' where id = ${med.id}`);
    // Her son also signs in by email: the alert must reach him there too, not only in the app.
    await ctx.db.execute(sql`update users set email = 'arjun@example.com', email_verified_at = now() where id = ${son.id}`);
    expect((await svc.tick()).escalated).toBe(1);
    const jobs = (await ctx.db.execute(sql`select channel from notification_jobs where user_id = ${son.id} and template = 'checkin_missed_alert'`)).rows as { channel: string }[];
    expect(jobs.map((j) => j.channel)).toEqual(expect.arrayContaining(['sms', 'email', 'push']));
    // Text messages can show on a lock screen, so they never name the medicine.
    expect(words('medicine').missedSms('Kamla')).not.toContain('BP tablet');
    expect(words('medicine').sms('BP tablet')).not.toContain('BP tablet');
    const notes = (await ctx.http.get('/v1/notifications').set(auth(son)).expect(200)).body;
    expect(JSON.stringify(notes)).toContain("Kamla hasn't confirmed BP tablet");

    const view = (await ctx.http.get('/v1/care/people').set(auth(son)).expect(200)).body.people[0];
    expect(view.status).toBe('missed');
    expect(view.today.find((i: { id: string }) => i.id === med.id).state).toBe('escalated');
    expect(view.appointments).toBeNull(); // calendar was not shared

    // She taps Taken: her son hears she has confirmed.
    await ctx.http.post(`/v1/check-ins/events/${med.id}/complete`).set(auth(mother)).send({}).expect(200);
    const after = (await ctx.http.get('/v1/care/people').set(auth(son)).expect(200)).body.people[0];
    expect(after.status).not.toBe('missed');
    expect(JSON.stringify((await ctx.http.get('/v1/notifications').set(auth(son)).expect(200)).body)).toContain('Kamla has now confirmed');
  });

  it('help requests show at the top of his view; strangers see nothing', async () => {
    await ctx.http.post('/v1/help/requests').set(auth(mother)).set('Idempotency-Key', `care-${Date.now()}`).send({ kind: 'notify_contacts', message: 'I fell' }).expect(201);
    const view = (await ctx.http.get('/v1/care/people').set(auth(son)).expect(200)).body.people[0];
    expect(view.status).toBe('help');
    expect(view.openHelp[0].message).toBe('I fell');
    expect((await ctx.http.get('/v1/care/people').set(auth(stranger)).expect(200)).body.people).toEqual([]);
    // Someone who only shares a calendar is not listed as a person being looked after.
    await connect(ctx, stranger, son, ['calendar.view']);
    expect((await ctx.http.get('/v1/care/people').set(auth(son)).expect(200)).body.people.map((p: { userId: string }) => p.userId)).toEqual([mother.id]);
    expect((await ctx.http.get('/v1/care/today').set(auth(mother)).expect(200)).body.openHelp).not.toBeNull();
  });

  it('a parent can set up first and invite her daughter after; the daughter is added to the alerts when she accepts', async () => {
    const dadi = await signup(ctx, 'Dadi');
    const daughter = await signup(ctx, 'Meera');
    await ctx.http.post('/v1/care/setup').set(auth(dadi)).send({ checkInTime: '09:30', consentToAlertContacts: true, medicines: [{ name: 'Thyroid', times: ['07:00'] }], medicineAlerts: true }).expect(200);
    const inv = await ctx.http.post('/v1/contacts/invitations').set(auth(dadi)).send({ phone: daughter.phone, proposedScopes: ['checkins.view', 'checkins.alerts', 'help.alerts'] }).expect(201);
    const tok = new URL(inv.body.inviteLink.replace('#token=', '?token=')).searchParams.get('token')!;
    await ctx.http.post('/v1/contacts/invitations/accept').set(auth(daughter)).send({ token: tok }).expect(200);
    const schedules = (await ctx.http.get('/v1/check-ins/schedules').set(auth(dadi)).expect(200)).body;
    expect(schedules).toHaveLength(2);
    expect(schedules.every((s: { escalate: boolean; escalationContacts: { userId: string }[] }) => s.escalate && s.escalationContacts.some((c) => c.userId === daughter.id))).toBe(true);
    await expireCooloff(ctx);
    await ctx.app.get(ContactsService).activateDueGrants();
    const view = (await ctx.http.get('/v1/care/people').set(auth(daughter)).expect(200)).body.people;
    expect(view.map((p: { displayName: string }) => p.displayName)).toEqual(['Dadi']);
    expect(view[0].status).not.toBe('not_set_up');
  });

  it('a caregiver may propose a new medicine reminder, but only the parent can approve it; declining changes nothing', async () => {
    // Mother and son are already trusted contacts from an earlier test, so this shares one more scope with him directly.
    await ctx.http.post('/v1/grants').set(auth(mother)).send({ granteeId: son.id, scopes: ['checkins.suggest'] }).expect(201);
    await expireCooloff(ctx);
    await ctx.app.get(ContactsService).activateDueGrants();
    // No grant, no proposal.
    await ctx.http.post('/v1/care/suggestions').set(auth(stranger)).send({ targetUserId: mother.id, kind: 'add_medicine', name: 'Vitamin D', times: ['09:00'] }).expect(404);

    const before = (await ctx.http.get('/v1/check-ins/schedules').set(auth(mother)).expect(200)).body.length;
    const proposed = await ctx.http.post('/v1/care/suggestions').set(auth(son)).send({ targetUserId: mother.id, kind: 'add_medicine', name: 'Vitamin D', times: ['09:00'] }).expect(201);
    expect(proposed.body.status).toBe('pending');
    // Proposing never touches her schedule by itself.
    expect((await ctx.http.get('/v1/check-ins/schedules').set(auth(mother)).expect(200)).body).toHaveLength(before);
    const forMe = (await ctx.http.get('/v1/care/suggestions').set(auth(mother)).expect(200)).body.forMe;
    expect(forMe).toHaveLength(1);
    expect(forMe[0].proposedByName).toBe('Arjun');
    const byMe = (await ctx.http.get('/v1/care/suggestions').set(auth(son)).expect(200)).body.byMe;
    expect(byMe[0].targetName).toBe('Kamla');

    // She declines: still nothing added.
    await ctx.http.post(`/v1/care/suggestions/${proposed.body.id}/decline`).set(auth(mother)).expect(200);
    expect((await ctx.http.get('/v1/check-ins/schedules').set(auth(mother)).expect(200)).body).toHaveLength(before);

    // He proposes again; he cannot approve his own suggestion — only she can.
    const again = await ctx.http
      .post('/v1/care/suggestions')
      .set(auth(son))
      .send({ targetUserId: mother.id, kind: 'add_medicine', name: 'Vitamin D', times: ['09:00', '21:00'] })
      .expect(201);
    await ctx.http.post(`/v1/care/suggestions/${again.body.id}/approve`).set(auth(son)).expect(404);
    await ctx.http.post(`/v1/care/suggestions/${again.body.id}/approve`).set(auth(mother)).expect(200);
    // Approving twice does nothing the second time.
    await ctx.http.post(`/v1/care/suggestions/${again.body.id}/approve`).set(auth(mother)).expect(422);
    const after = (await ctx.http.get('/v1/check-ins/schedules').set(auth(mother)).expect(200)).body;
    expect(after).toHaveLength(before + 2);
    expect(after.filter((s: { label: string }) => s.label === 'Vitamin D')).toHaveLength(2);
  });

  it('the voice assistant answers "how is Maa" from what she shared', async () => {
    const r = await ctx.http.post('/v1/voice/ask').set(auth(son)).send({ question: 'Did mummy take her medicine?' }).expect(200);
    expect(r.body.usedTools).toEqual(['check_ins']);
    expect(r.body.answer).toContain('Kamla');
    const own = await ctx.http.post('/v1/voice/ask').set(auth(mother)).send({ question: 'मेरी दवाई?' }).expect(200);
    expect(own.body.answer).toContain('BP tablet');
  });
});
