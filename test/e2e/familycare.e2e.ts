import { sql } from 'drizzle-orm';
import { simulatedOutbox } from '../../src/adapters/messaging';
import { CheckinsService, computeNextDue } from '../../src/modules/checkins/checkins.service';
import { ContactsService } from '../../src/modules/contacts/contacts.service';
import { NotificationsService } from '../../src/modules/notifications/notifications.service';
import { auth, boot, connect, Ctx, expireCooloff, idem, reauth, shutdown, signup, TestUser } from '../helpers';

describe('FamilyCare: contacts, grants, check-ins, help', () => {
  let ctx: Ctx;
  let senior: TestUser;
  let daughter: TestUser;
  let neighbour: TestUser;

  beforeAll(async () => {
    ctx = await boot();
    senior = await signup(ctx, 'Kamla');
    daughter = await signup(ctx, 'Priya');
    neighbour = await signup(ctx, 'Ravi');
  });
  afterAll(() => shutdown(ctx));

  it('invitations are bound to the invited phone number', async () => {
    const inv = await ctx.http.post('/v1/contacts/invitations').set(auth(senior)).send({ phone: daughter.phone }).expect(201);
    const token = new URL(inv.body.inviteLink.replace('#token=', '?token=')).searchParams.get('token')!;
    // The neighbour got hold of the link: refused.
    const r = await ctx.http.post('/v1/contacts/invitations/accept').set(auth(neighbour)).send({ token }).expect(403);
    expect(r.body.code).toBe('invitation_not_for_you');
    await ctx.http.post('/v1/contacts/invitations/accept').set(auth(daughter)).send({ token }).expect(200);
    const list = await ctx.http.get('/v1/contacts').set(auth(senior)).expect(200);
    expect(list.body.map((c: { contactUserId: string }) => c.contactUserId)).toContain(daughter.id);
  });

  it('grants require re-auth, start after cooling-off, and alert the grantor by SMS', async () => {
    await ctx.db.execute(sql`update auth.sessions set created_at = now() - interval '1 hour' where user_id = ${senior.id}`);
    const denied = await ctx.http.post('/v1/grants').set(auth(senior)).send({ granteeId: daughter.id, scopes: ['checkins.alerts'] }).expect(403);
    expect(denied.body.code).toBe('reauth_required');
    await reauth(ctx, senior);
    const before = simulatedOutbox.length;
    const res = await ctx.http.post('/v1/grants').set(auth(senior)).send({ granteeId: daughter.id, scopes: ['checkins.alerts', 'checkins.view', 'help.alerts', 'help.location'] }).expect(201);
    expect(res.body.every((g: { status: string }) => g.status === 'pending_cooloff')).toBe(true);
    expect(simulatedOutbox.slice(before).some((m) => m.channel === 'sms' && m.to === senior.phone)).toBe(true);
    // Not effective yet.
    await ctx.http.get(`/v1/check-ins/events?userId=${senior.id}`).set(auth(daughter)).expect(404);
    await expireCooloff(ctx);
    await ctx.app.get(ContactsService).activateDueGrants();
    await ctx.http.get(`/v1/check-ins/events?userId=${senior.id}`).set(auth(daughter)).expect(200);
    const who = await ctx.http.get('/v1/grants/who-can-see-me').set(auth(senior)).expect(200);
    expect(who.body.total).toBe(1);
  });

  it('escalation contacts must hold checkins.alerts, and contact alerts need explicit consent', async () => {
    await connect(ctx, senior, neighbour, []);
    const noGrant = await ctx.http
      .post('/v1/check-ins/schedules')
      .set(auth(senior))
      .send({ label: 'Morning', kind: 'daily', timeLocal: '09:00', escalationContactIds: [neighbour.id], consentToAlertContacts: true })
      .expect(422);
    expect(noGrant.body.code).toBe('grant_required');
    const noConsent = await ctx.http.post('/v1/check-ins/schedules').set(auth(senior)).send({ label: 'Morning', kind: 'daily', timeLocal: '09:00', escalationContactIds: [daughter.id] }).expect(422);
    expect(noConsent.body.code).toBe('consent_required');
  });

  it('missed check-in: prompt → reminder → escalation to the chosen contact; daughter acknowledges', async () => {
    const svc = ctx.app.get(CheckinsService);
    const sched = await ctx.http
      .post('/v1/check-ins/schedules')
      .set(auth(senior))
      .send({ label: 'Morning check-in', kind: 'daily', timeLocal: '09:00', reminderAfterMinutes: 15, graceMinutes: 30, escalationContactIds: [daughter.id], consentToAlertContacts: true })
      .expect(201);
    expect(sched.body.escalate).toBe(true);
    expect(sched.body.escalationContacts[0].userId).toBe(daughter.id);

    // Pretend the check-in was due 5 minutes ago.
    await ctx.db.execute(sql`update check_in_schedules set next_due_at = now() - interval '5 minutes' where id = ${sched.body.id}`);
    let r = await svc.tick();
    expect(r.created).toBe(1);
    const [ev] = (await ctx.db.execute(sql`select id, state from check_in_events where schedule_id = ${sched.body.id}`)).rows as { id: string; state: string }[];
    expect(ev.state).toBe('pending');

    // 20 minutes later: reminder.
    await ctx.db.execute(sql`update check_in_events set due_at = now() - interval '20 minutes' where id = ${ev.id}`);
    r = await svc.tick();
    expect(r.reminded).toBe(1);

    // Grace period passes: escalated to the daughter.
    await ctx.db.execute(sql`update check_in_events set reminded_at = now() - interval '31 minutes' where id = ${ev.id}`);
    r = await svc.tick();
    expect(r.escalated).toBe(1);

    const detail = await ctx.http.get(`/v1/check-ins/events/${ev.id}`).set(auth(daughter)).expect(200);
    expect(detail.body.state).toBe('escalated');
    expect(detail.body.alertDeliveries[0].recipientUserId).toBe(daughter.id);
    // Delivery is reported honestly: queued or simulated, never "delivered" without a provider receipt.
    for (const c of detail.body.alertDeliveries[0].channels) expect(['queued', 'sending', 'sent', 'simulated', 'failed', 'suppressed']).toContain(c.status);

    const inbox = await ctx.http.get('/v1/notifications').set(auth(daughter)).expect(200);
    const alert = inbox.body.items.find((n: { data: { type: string } }) => n.data.type === 'check_in_event');
    expect(alert.title).toContain('missed');
    expect(alert.body).toContain('does not necessarily mean');

    // The neighbour (no alerts grant) cannot see or acknowledge it.
    await ctx.http.get(`/v1/check-ins/events/${ev.id}`).set(auth(neighbour)).expect(404);
    await ctx.http.post(`/v1/check-ins/events/${ev.id}/acknowledge`).set(auth(neighbour)).send({}).expect(404);

    const ack = await ctx.http.post(`/v1/check-ins/events/${ev.id}/acknowledge`).set(auth(daughter)).send({ note: 'Called her, all fine' }).expect(200);
    expect(ack.body.state).toBe('acknowledged');
  });

  it("'I'm OK' completes the current check-in", async () => {
    const s = await ctx.http.post('/v1/check-ins/schedules').set(auth(senior)).send({ label: 'Evening', kind: 'daily', timeLocal: '20:00' }).expect(201);
    await ctx.db.execute(sql`update check_in_schedules set next_due_at = now() - interval '1 minute' where id = ${s.body.id}`);
    await ctx.app.get(CheckinsService).tick();
    const ok = await ctx.http.post('/v1/check-ins/now').set(auth(senior)).send({}).expect(200);
    expect(ok.body.status).toBe('completed');
  });

  it('withdrawing check-in consent stops escalation immediately', async () => {
    await ctx.http.delete('/v1/privacy/consents/checkins_sharing').set(auth(senior)).expect(200);
    const list = await ctx.http.get('/v1/check-ins/schedules').set(auth(senior)).expect(200);
    expect(list.body.every((x: { escalate: boolean }) => !x.escalate)).toBe(true);
  });

  it('computes next due times in the user time zone, including weekly schedules', () => {
    const after = new Date('2026-10-16T05:00:00Z'); // 10:30 IST Friday
    const daily = computeNextDue({ kind: 'daily', timeLocal: '09:00', daysOfWeek: null, oneOffAt: null, timezone: 'Asia/Kolkata' }, after)!;
    expect(daily.toISOString()).toBe('2026-10-17T03:30:00.000Z');
    const weekly = computeNextDue({ kind: 'weekly', timeLocal: '18:00', daysOfWeek: [1], oneOffAt: null, timezone: 'Asia/Kolkata' }, after)!;
    expect(weekly.toISOString()).toBe('2026-10-19T12:30:00.000Z'); // Monday 18:00 IST
  });

  it('help button: notifies contacts with help.alerts, is idempotent, and shares location only with consent', async () => {
    const key = idem();
    const noConsent = await ctx.http.post('/v1/help/requests').set(auth(senior)).set('Idempotency-Key', idem()).send({ kind: 'notify_contacts', shareLocation: true, lat: 28.6139, lng: 77.209 }).expect(409);
    expect(noConsent.body.code).toBe('consent_required');
    await ctx.http.put('/v1/help/preferences').set(auth(senior)).send({ shareLocationByDefault: true }).expect(200);

    const missingKey = await ctx.http.post('/v1/help/requests').set(auth(senior)).send({ kind: 'notify_contacts' }).expect(428);
    expect(missingKey.body.code).toBe('idempotency_key_required');

    const first = await ctx.http.post('/v1/help/requests').set(auth(senior)).set('Idempotency-Key', key).send({ kind: 'notify_contacts', message: 'I fell', shareLocation: true, lat: 28.61391, lng: 77.20902 }).expect(201);
    const again = await ctx.http.post('/v1/help/requests').set(auth(senior)).set('Idempotency-Key', key).send({ kind: 'notify_contacts', message: 'I fell', shareLocation: true, lat: 28.61391, lng: 77.20902 }).expect(201);
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(again.body.helpRequest.id).toBe(first.body.helpRequest.id);
    expect(first.body.actions.find((a: { type: string }) => a.type === 'notify_contacts').detail).toContain('Notifying 1');
    expect(first.body.callTargets[0].number).toBe('112');
    expect(first.body.disclaimer).toContain('not an emergency service');

    const id = first.body.helpRequest.id;
    const seen = await ctx.http.get(`/v1/help/requests/${id}`).set(auth(daughter)).expect(200);
    expect(seen.body.location).toEqual(expect.objectContaining({ lat: '28.6139', lng: '77.2090' }));
    await ctx.http.get(`/v1/help/requests/${id}`).set(auth(neighbour)).expect(404);
    const incoming = await ctx.http.get('/v1/help/requests/incoming').set(auth(daughter)).expect(200);
    expect(incoming.body.map((x: { id: string }) => x.id)).toContain(id);
    await ctx.http.post(`/v1/help/requests/${id}/acknowledge`).set(auth(daughter)).expect(200);
    const resolved = await ctx.http.post(`/v1/help/requests/${id}/resolve`).set(auth(senior)).expect(200);
    expect(resolved.body.status).toBe('resolved');
    expect(resolved.body.location).toBeNull(); // location erased on resolution
  });

  it('delivery status only becomes "delivered" through a provider webhook', async () => {
    const notifications = ctx.app.get(NotificationsService);
    const res = await notifications.notify({ userId: daughter.id, category: 'help', template: 't', title: 'x', channels: ['sms'], critical: true });
    const jobId = res.jobs[0].id;
    await ctx.db.execute(sql`update notification_jobs set provider = 'msg91', provider_message_id = 'abc-1', status = 'sent' where id = ${jobId}`);
    await ctx.http.post('/v1/notifications/webhooks/msg91/delivery?token=wrong').send({ providerMessageId: 'abc-1', delivered: true }).expect(403);
    const ok = await ctx.http.post('/v1/notifications/webhooks/msg91/delivery?token=change-me-webhook-secret').send({ providerMessageId: 'abc-1', delivered: true }).expect(200);
    expect(ok.body.updated).toBe(1);
    const [row] = (await ctx.db.execute(sql`select status from notification_jobs where id = ${jobId}`)).rows as { status: string }[];
    expect(row.status).toBe('delivered');
  });

  it('revoking a grant removes the contact from escalation lists and access ends', async () => {
    const grants = await ctx.http.get('/v1/grants?direction=given').set(auth(senior)).expect(200);
    const alerts = grants.body.find((g: { scope: string }) => g.scope === 'checkins.alerts');
    await ctx.http.delete(`/v1/grants/${alerts.id}`).set(auth(senior)).expect(200);
    const view = grants.body.find((g: { scope: string }) => g.scope === 'checkins.view');
    await ctx.http.delete(`/v1/grants/${view.id}`).set(auth(daughter)).expect(200); // grantee can give it up too
    await ctx.http.get(`/v1/check-ins/events?userId=${senior.id}`).set(auth(daughter)).expect(404);
    const scheds = await ctx.http.get('/v1/check-ins/schedules').set(auth(senior)).expect(200);
    expect(scheds.body.flatMap((x: { escalationContacts: unknown[] }) => x.escalationContacts)).toHaveLength(0);
    const activity = await ctx.http.get('/v1/me/activity').set(auth(senior)).expect(200);
    expect(activity.body.items.some((a: { action: string }) => a.action === 'grant.revoked')).toBe(true);
  });

  it('removing a contact revokes everything both ways', async () => {
    await ctx.http.delete(`/v1/contacts/${daughter.id}`).set(auth(senior)).expect(204);
    const g = await ctx.http.get('/v1/grants').set(auth(senior)).expect(200);
    expect(g.body.filter((x: { granteeId: string; grantorId: string }) => [x.granteeId, x.grantorId].includes(daughter.id))).toHaveLength(0);
  });
});
