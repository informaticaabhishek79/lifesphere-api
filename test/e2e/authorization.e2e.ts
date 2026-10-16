import { auth, boot, connect, Ctx, expireCooloff, reauth, shutdown, signup, TestUser } from '../helpers';

/**
 * Broken object-level authorization matrix: user A owns one of everything; user B (a stranger) must get 404 on
 * every read, update and delete, and must not see A's data in any list.
 */
describe('Authorization matrix (BOLA)', () => {
  let ctx: Ctx;
  let a: TestUser;
  let b: TestUser;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    ctx = await boot();
    a = await signup(ctx, 'Owner A');
    b = await signup(ctx, 'Stranger B');
    const H = auth(a);
    const post = (url: string, body: object) => ctx.http.post(url).set(H).send(body);

    ids.task = (await post('/v1/tasks', { title: 'Private task', dueAt: new Date(Date.now() + 86400000).toISOString() }).expect(201)).body.id;
    ids.household = (await post('/v1/households', { name: 'A home' }).expect(201)).body.id;
    ids.hhTask = (await post('/v1/tasks', { title: 'Household chore', householdId: ids.household }).expect(201)).body.id;
    ids.list = (await post('/v1/lists', { name: 'Groceries' }).expect(201)).body.id;
    ids.listItem = (await post(`/v1/lists/${ids.list}/items`, { name: 'Milk' }).expect(201)).body.id;
    ids.inventory = (await post('/v1/inventory', { name: 'Fridge', category: 'appliance' }).expect(201)).body.id;
    ids.reminder = (await post('/v1/reminders', { title: 'Pills', fireAt: new Date(Date.now() + 3600000).toISOString() }).expect(201)).body.id;
    ids.event = (await post('/v1/calendar/events', { title: 'Doctor', startsAt: new Date(Date.now() + 86400000).toISOString() }).expect(201)).body.id;
    ids.purchase = (await post('/v1/consumer/purchases', { productCategory: 'phone' }).expect(201)).body.id;
    ids.case = (await post('/v1/consumer/cases', { title: 'Broken phone' }).expect(201)).body.id;
    ids.schedule = (await post('/v1/check-ins/schedules', { label: 'Morning', kind: 'daily', timeLocal: '09:00' }).expect(201)).body.id;
    ids.budget = (await post('/v1/budgets', { month: '2026-10-01', category: 'Food', plannedAmount: 5000 }).expect(201)).body.id;
    ids.civic = (await post('/v1/civic-issues', { category: 'streetlight', description: 'Light broken near park' }).expect(201)).body.id;
    ids.privacy = (await post('/v1/privacy/requests', { type: 'grievance', details: 'Question about my data' }).expect(201)).body.id;
    ids.help = (await ctx.http.post('/v1/help/requests').set(H).set('Idempotency-Key', 'help-key-0001').send({ kind: 'call' }).expect(201)).body.helpRequest.id;
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
    ids.attachment = (await ctx.http.post('/v1/attachments?purpose=consumer_case').set(H).attach('file', png, 'proof.png').expect(201)).body.id;
    ids.notification = (await ctx.http.get('/v1/notifications').set(H).expect(200)).body.items[0]?.id;
  });
  afterAll(() => shutdown(ctx));

  const rawCases: [string, string, string, object?][] = [
    ['GET', '/v1/tasks/{task}', 'task'],
    ['PATCH', '/v1/tasks/{task}', 'task', { title: 'pwned' }],
    ['DELETE', '/v1/tasks/{task}', 'task'],
    ['POST', '/v1/tasks/{task}/complete', 'task'],
    ['GET', '/v1/tasks/{hhTask}', 'hhTask'],
    ['GET', '/v1/households/{household}', 'household'],
    ['PATCH', '/v1/households/{household}', 'household', { name: 'pwned' }],
    ['POST', '/v1/households/{household}/invitations', 'household', { userId: '00000000-0000-7000-8000-000000000000' }],
    ['GET', '/v1/households/{household}/announcements', 'household'],
    ['GET', '/v1/lists/{list}', 'list'],
    ['POST', '/v1/lists/{list}/items', 'list', { name: 'x' }],
    ['PATCH', '/v1/lists/items/{listItem}', 'listItem', { done: true }],
    ['DELETE', '/v1/lists/items/{listItem}', 'listItem'],
    ['GET', '/v1/inventory/{inventory}', 'inventory'],
    ['PATCH', '/v1/inventory/{inventory}', 'inventory', { name: 'x' }],
    ['GET', '/v1/reminders/{reminder}', 'reminder'],
    ['DELETE', '/v1/reminders/{reminder}', 'reminder'],
    ['GET', '/v1/calendar/events/{event}', 'event'],
    ['PATCH', '/v1/calendar/events/{event}', 'event', { title: 'x' }],
    ['GET', '/v1/consumer/purchases/{purchase}', 'purchase'],
    ['GET', '/v1/consumer/cases/{case}', 'case'],
    ['PATCH', '/v1/consumer/cases/{case}', 'case', { title: 'x' }],
    ['POST', '/v1/consumer/cases/{case}/drafts/generate', 'case', { whatHappened: 'something went wrong here', whatYouWant: 'refund' }],
    ['PATCH', '/v1/check-ins/schedules/{schedule}', 'schedule', { label: 'x' }],
    ['GET', '/v1/check-ins/events?userId={a}', 'a'],
    ['PATCH', '/v1/budgets/{budget}', 'budget', { plannedAmount: 1 }],
    ['GET', '/v1/civic-issues/{civic}', 'civic'],
    ['GET', '/v1/privacy/requests/{privacy}', 'privacy'],
    ['GET', '/v1/help/requests/{help}', 'help'],
    ['GET', '/v1/attachments/{attachment}', 'attachment'],
    ['GET', '/v1/attachments/{attachment}/content', 'attachment'],
    ['DELETE', '/v1/attachments/{attachment}', 'attachment'],
    ['GET', '/v1/tasks?scope=shared&ownerUserId={a}', 'a'],
    ['GET', '/v1/calendar/events?from=2026-01-01T00:00:00Z&to=2027-01-01T00:00:00Z&ownerUserId={a}', 'a'],
    ['GET', '/v1/users/{a}/card', 'a'],
  ];

  // Every row has exactly 4 entries so jest never treats the 4th parameter as a done-callback.
  const cases = rawCases.map(([m, p, k, b]) => [m, p, k, b ?? null] as [string, string, string, object | null]);

  it.each(cases)('stranger: %s %s → 404', async (method, path, _key, body) => {
    const url = path.replace(/\{(\w+)\}/g, (_m, k) => (k === 'a' ? a.id : ids[k]));
    const req = (ctx.http as unknown as Record<string, (u: string) => import('supertest').Test>)[method.toLowerCase()](url).set(auth(b)).ok(() => true).timeout(5000);
    const res = body ? await req.send(body) : await req;
    expect([404]).toContain(res.status);
    expect(res.body.code).toBe('not_found');
  });

  it('stranger lists contain none of the owner data', async () => {
    const H = auth(b);
    const tasks = await ctx.http.get('/v1/tasks').set(H).expect(200);
    expect(tasks.body.items).toHaveLength(0);
    expect((await ctx.http.get('/v1/lists').set(H).expect(200)).body).toHaveLength(0);
    expect((await ctx.http.get('/v1/inventory').set(H).expect(200)).body).toHaveLength(0);
    expect((await ctx.http.get('/v1/consumer/cases').set(H).expect(200)).body.items).toHaveLength(0);
    expect((await ctx.http.get('/v1/reminders').set(H).expect(200)).body.items).toHaveLength(0);
    expect((await ctx.http.get('/v1/households').set(H).expect(200)).body).toHaveLength(0);
    expect((await ctx.http.get('/v1/check-ins/schedules').set(H).expect(200)).body).toHaveLength(0);
    const cal = await ctx.http.get('/v1/calendar/events?from=2026-01-01T00:00:00Z&to=2027-01-31T00:00:00Z').set(H).expect(200);
    expect(cal.body.items).toHaveLength(0);
  });

  it('owner data was not changed by any of the attempts', async () => {
    const t = await ctx.http.get(`/v1/tasks/${ids.task}`).set(auth(a)).expect(200);
    expect(t.body.title).toBe('Private task');
    expect(t.body.status).toBe('pending');
    await ctx.http.get(`/v1/attachments/${ids.attachment}`).set(auth(a)).expect(200);
  });

  it('household membership grants household items only, never personal ones', async () => {
    const m = await signup(ctx, 'Member M');
    const inv = await ctx.http.post(`/v1/households/${ids.household}/invitations`).set(auth(a)).send({ phone: m.phone }).expect(201);
    await ctx.http.post(`/v1/households/invitations/${inv.body.id}/respond`).set(auth(m)).send({ accept: true }).expect(200);
    await ctx.http.get(`/v1/tasks/${ids.hhTask}`).set(auth(m)).expect(200);
    await ctx.http.get(`/v1/tasks/${ids.task}`).set(auth(m)).expect(404);
    // Members can complete chores but not edit or delete them.
    await ctx.http.post(`/v1/tasks/${ids.hhTask}/complete`).set(auth(m)).expect(200);
    await ctx.http.patch(`/v1/tasks/${ids.hhTask}`).set(auth(m)).send({ title: 'renamed' }).expect(404);
    await ctx.http.delete(`/v1/tasks/${ids.hhTask}`).set(auth(m)).expect(404);
    // Members cannot invite (admin only).
    await ctx.http.post(`/v1/households/${ids.household}/invitations`).set(auth(m)).send({ phone: b.phone }).expect(404);
  });

  it('being a trusted contact grants nothing until a scope is shared, and only shared items are visible', async () => {
    const c = await signup(ctx, 'Contact C');
    await connect(ctx, a, c, []);
    await ctx.http.get(`/v1/tasks?scope=shared&ownerUserId=${a.id}`).set(auth(c)).expect(404);
    await reauth(ctx, a);
    await ctx.http.post('/v1/grants').set(auth(a)).send({ granteeId: c.id, scopes: ['tasks.view'] }).expect(201);
    // Cooling-off: not yet effective.
    await ctx.http.get(`/v1/tasks?scope=shared&ownerUserId=${a.id}`).set(auth(c)).expect(404);
    await expireCooloff(ctx);
    const none = await ctx.http.get(`/v1/tasks?scope=shared&ownerUserId=${a.id}`).set(auth(c)).expect(200);
    expect(none.body.items).toHaveLength(0); // private tasks stay private
    const shared = await ctx.http.post('/v1/tasks').set(auth(a)).send({ title: 'Shared with family', visibility: 'shared' }).expect(201);
    const some = await ctx.http.get(`/v1/tasks?scope=shared&ownerUserId=${a.id}`).set(auth(c)).expect(200);
    expect(some.body.items.map((t: { id: string }) => t.id)).toEqual([shared.body.id]);
    await ctx.http.get(`/v1/tasks/${shared.body.id}`).set(auth(c)).expect(200);
    await ctx.http.patch(`/v1/tasks/${shared.body.id}`).set(auth(c)).send({ title: 'x' }).expect(404);
    // Revocation is immediate.
    const grants = await ctx.http.get('/v1/grants?direction=given').set(auth(a)).expect(200);
    await ctx.http.delete(`/v1/grants/${grants.body[0].id}`).set(auth(a)).expect(200);
    await ctx.http.get(`/v1/tasks/${shared.body.id}`).set(auth(c)).expect(404);
  });

  it('a user cannot grant access to a stranger or to themselves', async () => {
    await reauth(ctx, a);
    await ctx.http.post('/v1/grants').set(auth(a)).send({ granteeId: b.id, scopes: ['tasks.view'] }).expect(404);
    await ctx.http.post('/v1/grants').set(auth(a)).send({ granteeId: a.id, scopes: ['tasks.view'] }).expect(400);
  });

  it('admin endpoints expose no private content routes', async () => {
    const res = await ctx.http.get('/docs/openapi.json').expect(200);
    const adminPaths = Object.keys(res.body.paths).filter((p) => p.startsWith('/v1/admin'));
    const privateSegments = ['tasks', 'lists', 'check-ins', 'consumer', 'conversations', 'reminders', 'calendar', 'inventory', 'help'];
    for (const seg of privateSegments) {
      expect(adminPaths.filter((p) => p.split('/').includes(seg))).toEqual([]);
    }
  });
});
