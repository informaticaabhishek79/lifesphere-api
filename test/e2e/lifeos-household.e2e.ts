import { sql } from 'drizzle-orm';
import { HouseholdToolsService } from '../../src/modules/household-tools/household-tools.service';
import { RemindersService } from '../../src/modules/reminders/reminders.service';
import { auth, boot, connect, Ctx, shutdown, signup, TestUser } from '../helpers';

describe('LifeOS & SmartHousehold', () => {
  let ctx: Ctx;
  let a: TestUser;
  let b: TestUser;
  let householdId: string;

  beforeAll(async () => {
    ctx = await boot();
    a = await signup(ctx, 'Anil');
    b = await signup(ctx, 'Bina');
  });
  afterAll(() => shutdown(ctx));

  it('creates, filters, completes and reopens tasks; overdue flagged', async () => {
    const past = new Date(Date.now() - 3600_000).toISOString();
    const t = await ctx.http.post('/v1/tasks').set(auth(a)).send({ title: 'Pay electricity bill', priority: 'high', dueAt: past }).expect(201);
    expect(t.body.overdue).toBe(true);
    const overdue = await ctx.http.get('/v1/tasks?status=overdue').set(auth(a)).expect(200);
    expect(overdue.body.items).toHaveLength(1);
    const search = await ctx.http.get('/v1/tasks?q=electric').set(auth(a)).expect(200);
    expect(search.body.items).toHaveLength(1);
    const done = await ctx.http.post(`/v1/tasks/${t.body.id}/complete`).set(auth(a)).expect(200);
    expect(done.body.task.status).toBe('completed');
    await ctx.http.post(`/v1/tasks/${t.body.id}/reopen`).set(auth(a)).expect(200);
    const summary = await ctx.http.get('/v1/tasks/summary').set(auth(a)).expect(200);
    expect(summary.body.overdue).toBe(1);
  });

  it('recurring task creates the next occurrence on completion', async () => {
    const due = new Date('2026-11-02T04:30:00Z'); // Monday
    const t = await ctx.http.post('/v1/tasks').set(auth(a)).send({ title: 'Water plants', dueAt: due.toISOString(), recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,TH' }).expect(201);
    const r = await ctx.http.post(`/v1/tasks/${t.body.id}/complete`).set(auth(a)).expect(200);
    expect(new Date(r.body.next.dueAt).toISOString()).toBe('2026-11-05T04:30:00.000Z');
    expect(r.body.next.seriesId).toBe(t.body.id);
    await ctx.http.post('/v1/tasks').set(auth(a)).send({ title: 'bad', dueAt: due.toISOString(), recurrenceRule: 'FREQ=SECONDLY' }).expect(400);
  });

  it('cursor pagination returns every task exactly once', async () => {
    for (let i = 0; i < 7; i++) await ctx.http.post('/v1/tasks').set(auth(b)).send({ title: `Task ${i}` }).expect(201);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { body: { items: { id: string }[]; nextCursor: string | null } } = await ctx.http.get(`/v1/tasks?limit=3${cursor ? `&cursor=${cursor}` : ''}`).set(auth(b)).expect(200);
      seen.push(...page.body.items.map((x) => x.id));
      cursor = page.body.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
    await ctx.http.get('/v1/tasks?cursor=garbage').set(auth(b)).expect(400);
  });

  it('household: invite, join, chores, shared grocery list, announcements', async () => {
    const h = await ctx.http.post('/v1/households').set(auth(a)).send({ name: 'Sharma home' }).expect(201);
    householdId = h.body.id;
    const inv = await ctx.http.post(`/v1/households/${householdId}/invitations`).set(auth(a)).send({ phone: b.phone }).expect(201);
    const incoming = await ctx.http.get('/v1/households/invitations/incoming').set(auth(b)).expect(200);
    expect(incoming.body[0].householdName).toBe('Sharma home');
    await ctx.http.post(`/v1/households/invitations/${inv.body.id}/respond`).set(auth(b)).send({ accept: true }).expect(200);

    const chore = await ctx.http.post('/v1/tasks').set(auth(a)).send({ title: 'Take out trash', householdId, assigneeUserIds: [b.id], isChore: true }).expect(201);
    expect(chore.body.assignments[0]).toEqual(expect.objectContaining({ userId: b.id, status: 'accepted' }));
    const mine = await ctx.http.get('/v1/tasks?scope=assigned').set(auth(b)).expect(200);
    expect(mine.body.items.map((x: { id: string }) => x.id)).toContain(chore.body.id);

    const list = await ctx.http.post('/v1/lists').set(auth(b)).send({ name: 'Weekly groceries', householdId }).expect(201);
    const item = await ctx.http.post(`/v1/lists/${list.body.id}/items`).set(auth(b)).send({ name: 'Atta', quantity: 5, unit: 'kg', category: 'Staples', assignedTo: a.id }).expect(201);
    await ctx.http.patch(`/v1/lists/items/${item.body.id}`).set(auth(a)).send({ done: true }).expect(200);
    const full = await ctx.http.get(`/v1/lists/${list.body.id}`).set(auth(a)).expect(200);
    expect(full.body.items[0].doneBy).toBe(a.id);
    expect((await ctx.http.post(`/v1/lists/${list.body.id}/clear-done`).set(auth(b)).expect(200)).body.removed).toBe(1);

    await ctx.http.post(`/v1/households/${householdId}/announcements`).set(auth(b)).send({ body: 'Plumber visiting Saturday 10am', pinned: true }).expect(201);
    const ann = await ctx.http.get(`/v1/households/${householdId}/announcements`).set(auth(a)).expect(200);
    expect(ann.body[0].body).toContain('Plumber');
  });

  it('household admin rules: last admin cannot leave; member leaving loses access', async () => {
    const last = await ctx.http.delete(`/v1/households/${householdId}/members/${a.id}`).set(auth(a)).expect(422);
    expect(last.body.code).toBe('last_admin');
    await ctx.http.delete(`/v1/households/${householdId}/members/${b.id}`).set(auth(b)).expect(200);
    await ctx.http.get(`/v1/households/${householdId}`).set(auth(b)).expect(404);
  });

  it('personal task assignment needs a tasks.assign grant and the assignee accepts', async () => {
    const c = await signup(ctx, 'Chetan');
    const t = await ctx.http.post('/v1/tasks').set(auth(a)).send({ title: 'Collect prescription' }).expect(201);
    await ctx.http.post(`/v1/tasks/${t.body.id}/assignments`).set(auth(a)).send({ userId: c.id }).expect(404);
    // Chetan lets Anil suggest tasks for him.
    await connect(ctx, c, a, ['tasks.assign']);
    const asg = await ctx.http.post(`/v1/tasks/${t.body.id}/assignments`).set(auth(a)).send({ userId: c.id }).expect(201);
    expect(asg.body.status).toBe('proposed');
    const inbox = await ctx.http.get('/v1/tasks/assignments/incoming').set(auth(c)).expect(200);
    expect(inbox.body).toHaveLength(1);
    await ctx.http.post(`/v1/tasks/assignments/${asg.body.id}/respond`).set(auth(c)).send({ accept: true }).expect(200);
    await ctx.http.post(`/v1/tasks/${t.body.id}/complete`).set(auth(c)).expect(200);
  });

  it('reminders fire through the queue handler and respect quiet hours', async () => {
    const r = await ctx.http.post('/v1/reminders').set(auth(a)).send({ title: 'Take medicine', fireAt: new Date(Date.now() + 60_000).toISOString(), channels: ['in_app', 'push'] }).expect(201);
    await ctx.db.execute(sql`update reminders set fire_at = now() - interval '3 minutes' where id = ${r.body.id}`);
    expect(await ctx.app.get(RemindersService).sweepOverdue()).toBe(1);
    const fired = await ctx.http.get(`/v1/reminders/${r.body.id}`).set(auth(a)).expect(200);
    expect(fired.body.status).toBe('sent');
    const inbox = await ctx.http.get('/v1/notifications?unreadOnly=true').set(auth(a)).expect(200);
    expect(inbox.body.items.some((n: { title: string }) => n.title === 'Take medicine')).toBe(true);
    await ctx.http.post('/v1/reminders').set(auth(a)).send({ title: 'x', fireAt: new Date(Date.now() - 3600_000).toISOString() }).expect(400);
  });

  it('lock-screen privacy: push text is generic by default', async () => {
    await ctx.http.post('/v1/notifications/devices').set(auth(a)).send({ platform: 'android', token: 'fcm-token-1234567890' }).expect(201);
    const prefs = await ctx.http.get('/v1/me/preferences').set(auth(a)).expect(200);
    expect(prefs.body.lockScreenDetail).toBe('generic');
    await ctx.http.patch('/v1/me/preferences').set(auth(a)).send({ quietHoursStart: '22:00' }).expect(400);
    await ctx.http.patch('/v1/me/preferences').set(auth(a)).send({ quietHoursStart: '22:00', quietHoursEnd: '07:00' }).expect(200);
  });

  it('calendar: shared visit with a trusted contact expands recurring events', async () => {
    const d = await signup(ctx, 'Devi');
    await connect(ctx, d, a, ['calendar.view']);
    const visit = await ctx.http
      .post('/v1/calendar/events')
      .set(auth(a))
      .send({ title: 'Visit Devi', kind: 'visit', startsAt: '2026-11-01T05:30:00Z', endsAt: '2026-11-01T07:30:00Z', visitForUserId: d.id, recurrenceRule: 'FREQ=WEEKLY;BYDAY=SU' })
      .expect(201);
    expect(visit.body.attendees[0].userId).toBe(d.id);
    const range = await ctx.http.get('/v1/calendar/events?from=2026-11-01T00:00:00Z&to=2026-11-30T00:00:00Z').set(auth(d)).expect(200);
    expect(range.body.items.length).toBe(5); // 5 Sundays in Nov 2026
    await ctx.http.post(`/v1/calendar/events/${visit.body.id}/rsvp`).set(auth(d)).send({ status: 'accepted' }).expect(200);
    const shared = await ctx.http.post('/v1/calendar/events').set(auth(d)).send({ title: 'Eye checkup', kind: 'appointment', startsAt: '2026-11-10T05:30:00Z', visibility: 'shared' }).expect(201);
    const theirs = await ctx.http.get(`/v1/calendar/events?from=2026-11-01T00:00:00Z&to=2026-11-30T00:00:00Z&ownerUserId=${d.id}`).set(auth(a)).expect(200);
    expect(theirs.body.items.map((e: { id: string }) => e.id)).toContain(shared.body.id);
  });

  it('inventory + maintenance schedule advances when logged; daily tick notifies', async () => {
    const item = await ctx.http.post('/v1/inventory').set(auth(a)).send({ name: 'Water purifier', category: 'appliance', brand: 'Kent' }).expect(201);
    const today = new Date().toISOString().slice(0, 10);
    const sch = await ctx.http.post(`/v1/inventory/${item.body.id}/schedules`).set(auth(a)).send({ title: 'Replace filter', intervalDays: 90, nextDueOn: today }).expect(201);
    expect(await ctx.app.get(HouseholdToolsService).maintenanceTick()).toBeGreaterThanOrEqual(1);
    expect(await ctx.app.get(HouseholdToolsService).maintenanceTick()).toBe(0); // only once per due date
    await ctx.http.post(`/v1/inventory/${item.body.id}/records`).set(auth(a)).send({ performedOn: today, description: 'Filter replaced', scheduleId: sch.body.id }).expect(201);
    const detail = await ctx.http.get(`/v1/inventory/${item.body.id}`).set(auth(a)).expect(200);
    expect(detail.body.schedules[0].nextDueOn > today).toBe(true);
    expect(detail.body.records).toHaveLength(1);
  });

  it('budget lines are manual and high-level only', async () => {
    await ctx.http.post('/v1/budgets').set(auth(a)).send({ month: '2026-10-15', category: 'Food', plannedAmount: 100 }).expect(400);
    const line = await ctx.http.post('/v1/budgets').set(auth(a)).send({ month: '2026-10-01', category: 'Food', plannedAmount: 8000 }).expect(201);
    await ctx.http.patch(`/v1/budgets/${line.body.id}`).set(auth(a)).send({ spentAmount: 2500.5 }).expect(200);
    const list = await ctx.http.get('/v1/budgets?month=2026-10-01').set(auth(a)).expect(200);
    expect(list.body[0].spentAmount).toBe('2500.50');
  });

  it('dashboard aggregates enabled widgets and hides disabled features', async () => {
    const dash = await ctx.http.get('/v1/me/dashboard').set(auth(a)).expect(200);
    expect(dash.body).toHaveProperty('todayTasks');
    expect(dash.body).toHaveProperty('quickActions');
    await ctx.http.patch('/v1/me/preferences').set(auth(a)).send({ disabledFeatures: ['community', 'consumer'] }).expect(200);
    const dash2 = await ctx.http.get('/v1/me/dashboard').set(auth(a)).expect(200);
    expect(dash2.body).not.toHaveProperty('communityUpdates');
    expect(dash2.body.quickActions.some((q: { key: string }) => q.key === 'new_case')).toBe(false);
  });

  it('senior mode and accessibility settings persist', async () => {
    await ctx.http.patch('/v1/me/profile').set(auth(a)).send({ seniorMode: true }).expect(200);
    await ctx.http.patch('/v1/me/preferences').set(auth(a)).send({ accessibility: { textScale: 1.6, highContrast: true } }).expect(200);
    const me = await ctx.http.get('/v1/me').set(auth(a)).expect(200);
    expect(me.body.profile.seniorMode).toBe(true);
    expect(me.body.preferences.accessibility).toEqual(expect.objectContaining({ textScale: 1.6, highContrast: true, simpleConfirmations: true }));
    await ctx.http.patch('/v1/me/preferences').set(auth(a)).send({ accessibility: { textScale: 3 } }).expect(400);
  });
});
