import { AiAdapter } from '../../src/adapters/ai';
import { auth, boot, connect, Ctx, shutdown, signup, TestUser } from '../helpers';

describe('Voice assistant: answers from the right part of the app, and only what the person may see', () => {
  let ctx: Ctx;
  let u: TestUser;
  let other: TestUser;
  const ask = (who: TestUser, question: string, history: unknown[] = []) => ctx.http.post('/v1/voice/ask').set(auth(who)).send({ question, history }).expect(200);
  let bills: string;
  let privateFolder: string;

  beforeAll(async () => {
    ctx = await boot();
    u = await signup(ctx, 'Priya');
    other = await signup(ctx, 'Stranger');
    const H = auth(u);
    // "Later today" stays inside today however late the tests run (a few minutes ahead).
    const inHours = (h: number) => new Date(Date.now() + h * 180_000).toISOString();
    await ctx.http.post('/v1/tasks').set(H).send({ title: 'Pay electricity bill', dueAt: inHours(1) }).expect(201);
    await ctx.http.post('/v1/tasks').set(H).send({ title: 'Renew passport photo', dueAt: new Date(Date.now() - 86400_000).toISOString() }).expect(201);
    await ctx.http.post('/v1/tasks').set(auth(other)).send({ title: 'Stranger secret task', dueAt: inHours(1) }).expect(201);
    await ctx.http.post('/v1/calendar/events').set(H).send({ title: 'Dentist', startsAt: inHours(2), kind: 'appointment', locationText: 'City Clinic' }).expect(201);
    const list = (await ctx.http.post('/v1/lists').set(H).send({ name: 'Groceries' }).expect(201)).body;
    await ctx.http.post(`/v1/lists/${list.id}/items`).set(H).send({ name: 'Atta', quantity: 5, unit: 'kg' }).expect(201);
    await ctx.http.post(`/v1/lists/${list.id}/items`).set(H).send({ name: 'Milk' }).expect(201);
    const month = new Date().toISOString().slice(0, 7) + '-01';
    await ctx.http.post('/v1/budgets').set(H).send({ month, category: 'Groceries', plannedAmount: 8000, spentAmount: 9000 }).expect(201);
    await ctx.http.post('/v1/inventory').set(H).send({ name: 'Water purifier', category: 'appliance', warrantyExpiresOn: '2027-03-31' }).expect(201);
    bills = (await ctx.http.post('/v1/documents/folders').set(H).send({ name: 'Bills' }).expect(201)).body.id;
    privateFolder = (await ctx.http.post('/v1/documents/folders').set(H).send({ name: 'Private' }).expect(201)).body.id;
    await ctx.http.post('/v1/documents/files/text').set(H).send({ folderId: bills, name: 'electricity.txt', content: 'City Power. Amount due: 1,240. Due date: 28 October.' }).expect(201);
    await ctx.http.post('/v1/documents/files/text').set(H).send({ folderId: privateFolder, name: 'diary.txt', content: 'Electricity of my feelings — private diary.' }).expect(201);
  });
  afterAll(() => shutdown(ctx));

  it('routes everyday questions to the right feature and reads real data', async () => {
    const day = await ask(u, 'What is my day today?');
    expect(day.body.usedTools).toEqual(['tasks', 'calendar']);
    expect(day.body.answer).toContain('Pay electricity bill');
    expect(day.body.answer).toContain('Dentist');
    expect(day.body.answer).not.toContain('Stranger secret task');
    expect(day.body.links.map((l: { href: string }) => l.href)).toEqual(expect.arrayContaining(['/tasks', '/calendar']));

    expect((await ask(u, 'Anything overdue?')).body.answer).toContain('Renew passport photo');
    const shop = await ask(u, 'What do I need to buy?');
    expect(shop.body.usedTools).toEqual(['shopping_lists']);
    expect(shop.body.answer).toMatch(/5 kg Atta.*Milk/);
    const budget = await ask(u, 'How much have I spent this month?');
    expect(budget.body.answer).toContain('Over budget: Groceries');
    expect((await ask(u, 'When does the water purifier warranty end?')).body.answer).toContain('2027-03-31');
    const hh = (await ctx.http.post('/v1/households').set(auth(u)).send({ name: 'Home' }).expect(201)).body.id;
    await ctx.http.post('/v1/budgets').set(auth(u)).send({ month: new Date().toISOString().slice(0, 7) + '-01', category: 'Electricity', plannedAmount: 2000, spentAmount: 500, householdId: hh }).expect(201);
    expect((await ask(u, 'How much have I spent this month?')).body.answer).toMatch(/planned ₹10,000 and spent ₹9,500/);
    const sos = await ask(u, 'Help me, I fell');
    expect(sos.body.usedTools).toEqual(['emergency_help']);
    expect(sos.body.answer).toContain('112');
    const how = await ask(u, 'How do I set up a check-in?');
    expect(how.body.answer).toContain('New check-in');
    expect(how.body.simulated).toBe(true);
  });

  it('reads documents only in folders the person chose for it', async () => {
    const none = await ask(u, 'What is the amount due on my electricity bill document?');
    expect(none.body.usedTools).not.toContain('search_documents');
    expect(none.body.answer).toContain('What it can read');
    const s = await ctx.http.put('/v1/voice/settings').set(auth(u)).send({ documentFolderIds: [bills] }).expect(200);
    expect(s.body.documentFolders).toEqual([{ folderId: bills, path: 'Bills' }]);
    const found = await ask(u, 'What is the amount due on my electricity bill document?');
    expect(found.body.usedTools).toEqual(['search_documents']);
    expect(found.body.answer).toContain('1,240');
    expect(found.body.answer).not.toContain('diary');
    await ctx.http.put('/v1/voice/settings').set(auth(u)).send({ documentFolderIds: [privateFolder, '00000000-0000-7000-8000-000000000000'] }).expect(404);
    const theirs = (await ctx.http.post('/v1/documents/folders').set(auth(other)).send({ name: 'Theirs' }).expect(201)).body.id;
    await ctx.http.put('/v1/voice/settings').set(auth(u)).send({ documentFolderIds: [theirs] }).expect(404);
  });

  it('respects switched-off features and the assistant switch', async () => {
    await ctx.http.patch('/v1/me/preferences').set(auth(u)).send({ disabledFeatures: ['household'] }).expect(200);
    const r = await ask(u, 'What do I need to buy?');
    expect(r.body.usedTools).toEqual([]);
    expect(r.body.answer).toMatch(/switched off/);
    await ctx.http.patch('/v1/me/preferences').set(auth(u)).send({ disabledFeatures: ['assistant'] }).expect(200);
    expect((await ctx.http.post('/v1/voice/ask').set(auth(u)).send({ question: 'Hi' }).expect(409)).body.code).toBe('assistant_disabled');
    await ctx.http.patch('/v1/me/preferences').set(auth(u)).send({ disabledFeatures: [] }).expect(200);
  });

  it('with a real model: it chooses tools itself, but only allowed ones run', async () => {
    const ai = ctx.app.get(AiAdapter);
    const seen: string[] = [];
    const turns = [
      {
        content: [
          { type: 'tool_use', id: 'a', name: 'tasks', input: { when: 'today' } },
          { type: 'tool_use', id: 'b', name: 'read_document', input: { file_id: '00000000-0000-7000-8000-000000000000' } },
        ],
        stopReason: 'tool_use',
        model: 'fake',
      },
      { content: [{ type: 'text', text: 'You need to pay the electricity bill today.' }], stopReason: 'end_turn', model: 'fake' },
    ];
    const sim = jest.spyOn(ai, 'simulated', 'get').mockReturnValue(false);
    const turn = jest.spyOn(ai, 'toolTurn').mockImplementation(async (_s, messages, tools) => {
      seen.push(JSON.stringify({ last: messages[messages.length - 1], tools: tools.map((t) => t.name) }));
      return turns.shift() as never;
    });
    try {
      // Documents not shared with the assistant: read_document isn't offered, and refused if asked for.
      await ctx.http.put('/v1/voice/settings').set(auth(u)).send({ documentFolderIds: [] }).expect(200);
      const r = await ask(u, 'What do I need to do today?', [{ role: 'assistant', text: 'Hello!' }]);
      expect(r.body).toMatchObject({ answer: 'You need to pay the electricity bill today.', simulated: false, usedTools: ['tasks'] });
      expect(seen[0]).not.toContain('read_document');
      expect(seen[1]).toContain('Pay electricity bill');
      expect(seen[1]).toContain('not shared with the assistant');
      expect(seen.join('')).not.toContain('Stranger secret task');
    } finally {
      sim.mockRestore();
      turn.mockRestore();
    }
  });

  it('stores no conversation and is in the data export', async () => {
    const { PrivacyService } = await import('../../src/modules/privacy/privacy.service');
    const exp = await ctx.app.get(PrivacyService).collectUserData(u.id);
    expect(exp.voiceAssistantSettings).toHaveLength(1);
    expect(JSON.stringify(exp)).not.toContain('What do I need to buy?');
  });

  describe('companion chat: off by default, never reads data, and quietly tells family about a wellbeing mention', () => {
    let caregiver: TestUser;

    beforeAll(async () => {
      caregiver = await signup(ctx, 'Beta');
      await connect(ctx, u, caregiver, ['checkins.alerts']);
    });

    it('is off until turned on in settings', async () => {
      const off = (await ctx.http.get('/v1/voice/settings').set(auth(u)).expect(200)).body;
      expect(off.companionChatEnabled).toBe(false);
      await ctx.http.post('/v1/voice/companion').set(auth(u)).send({ message: 'Hello' }).expect(409);
      await ctx.http.put('/v1/voice/settings').set(auth(u)).send({ companionChatEnabled: true }).expect(200);
      const on = (await ctx.http.get('/v1/voice/settings').set(auth(u)).expect(200)).body;
      expect(on.companionChatEnabled).toBe(true);
    });

    it('answers ordinary chat with no family alert', async () => {
      const before = (await ctx.http.get('/v1/notifications').set(auth(caregiver)).expect(200)).body.items.length;
      const r = await ctx.http.post('/v1/voice/companion').set(auth(u)).send({ message: 'What a nice sunny day today!' }).expect(200);
      expect(r.body.concern).toBe(false);
      expect(typeof r.body.reply).toBe('string');
      expect((await ctx.http.get('/v1/notifications').set(auth(caregiver)).expect(200)).body.items).toHaveLength(before);
    });

    it('a loneliness mention is answered warmly and told to the same people who get missed-check-in alerts, without quoting her', async () => {
      const before = (await ctx.http.get('/v1/notifications').set(auth(caregiver)).expect(200)).body.items.length;
      const r = await ctx.http.post('/v1/voice/companion').set(auth(u)).send({ message: 'I feel so lonely, nobody visits me anymore.' }).expect(200);
      expect(r.body.concern).toBe(true);
      const notes = (await ctx.http.get('/v1/notifications').set(auth(caregiver)).expect(200)).body.items;
      expect(notes).toHaveLength(before + 1);
      const text = JSON.stringify(notes);
      expect(text).toContain('mentioned feeling a bit lonely');
      expect(text).not.toContain('nobody visits me');
      // A stranger never sees any of this.
      expect((await ctx.http.get('/v1/notifications').set(auth(other)).expect(200)).body.items.map((n: { title?: string }) => n.title ?? '').join('')).not.toContain('Priya');
    });

    it('with a real model: chats without any tools, and the emergency number is still offered for a safety concern', async () => {
      const ai = ctx.app.get(AiAdapter);
      const sim = jest.spyOn(ai, 'simulated', 'get').mockReturnValue(false);
      const complete = jest.spyOn(ai, 'complete').mockResolvedValue({ text: 'I am glad to hear it! Tell me more about your day.', model: 'fake', simulated: false });
      try {
        const r = await ctx.http.post('/v1/voice/companion').set(auth(u)).send({ message: 'Had a lovely lunch today.' }).expect(200);
        expect(r.body).toMatchObject({ reply: 'I am glad to hear it! Tell me more about your day.', concern: false });
        const [system] = complete.mock.calls[0];
        expect(system).toContain('not a friend');
        expect(system).toContain('112'); // India's emergency number, for this test user
      } finally {
        sim.mockRestore();
        complete.mockRestore();
      }
    });
  });
});
