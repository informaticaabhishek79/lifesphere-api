import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, eq, isNull } from 'drizzle-orm';
import { AiAdapter } from '../../src/adapters/ai';
import * as s from '../../src/db/schema';
import { InboxService } from '../../src/modules/inbox/inbox.service';
import { toInstant } from '../../src/modules/inbox/records';
import { auth, boot, Ctx, shutdown, signup, TestUser } from '../helpers';

const fixture = (n: string) => readFileSync(join(__dirname, '../fixtures/inbox', n));

describe('Smart inbox: files dropped in the inbox folder become tasks, events, lists, budget and more', () => {
  let ctx: Ctx;
  let u: TestUser;
  let other: TestUser;
  let inbox: InboxService;
  let folders: Record<string, string>;

  /** Upload into an inbox subfolder, then run the worker step for it. */
  const drop = async (folder: string, name: string, body: Buffer) => {
    const f = (await ctx.http.post(`/v1/documents/folders/${folders[folder]}/files`).set(auth(u)).attach('file', body, name).expect(201)).body;
    let row: typeof s.inboxImports.$inferSelect | undefined;
    for (let i = 0; i < 50 && !row; i++) {
      [row] = await ctx.db.select().from(s.inboxImports).where(eq(s.inboxImports.fileId, f.id));
      if (!row) await new Promise((r) => setTimeout(r, 40));
    }
    expect(row).toBeDefined();
    await inbox.process(row!.id);
    return (await ctx.http.get(`/v1/inbox/imports/${row!.id}`).set(auth(u)).expect(200)).body;
  };

  beforeAll(async () => {
    ctx = await boot();
    inbox = ctx.app.get(InboxService);
    u = await signup(ctx, 'Meera');
    other = await signup(ctx, 'Other');
  });
  afterAll(() => shutdown(ctx));

  it('sets up the inbox folder and its subfolders in Documents', async () => {
    expect((await ctx.http.get('/v1/inbox').set(auth(u)).expect(200)).body.setUp).toBe(false);
    const r = await ctx.http.post('/v1/inbox/setup').set(auth(u)).send({ aiConsent: false }).expect(200);
    expect(r.body).toMatchObject({ setUp: true, enabled: true, rootName: 'LifeSphere Inbox', aiReading: false });
    expect(r.body.folders).toHaveLength(11);
    expect(r.body.folders.every((f: { folderId: string | null }) => f.folderId)).toBe(true);
    folders = Object.fromEntries(r.body.folders.map((f: { hint: string; folderId: string }) => [f.hint, f.folderId]));
    folders.root = r.body.rootFolderId;
    // Running setup again reuses the folders.
    const again = await ctx.http.post('/v1/inbox/setup').set(auth(u)).send({}).expect(200);
    expect(again.body.rootFolderId).toBe(folders.root);
    const docs = await ctx.http.get('/v1/documents/folders').set(auth(u)).expect(200);
    expect(JSON.stringify(docs.body)).toContain('Home - Shopping lists');
  });

  it('a text file in Tasks becomes tasks with their due dates', async () => {
    const imp = await drop('tasks', 'todo.txt', Buffer.from('- Pay electricity bill by 2030-10-25\n- Renew car insurance 2030-11-02 10:30\n- Call the plumber'));
    expect(imp).toMatchObject({ status: 'done', reader: 'rules', category: 'tasks' });
    expect(imp.createdItems).toHaveLength(3);
    expect(imp.createdItems[0]).toMatchObject({ type: 'task', title: 'Pay electricity bill', href: expect.stringMatching(/^\/tasks\//) });
    const tasks = await ctx.http.get('/v1/tasks').set(auth(u)).expect(200);
    const list = (tasks.body.items ?? tasks.body) as { title: string; dueAt: string | null }[];
    const insurance = list.find((t) => t.title === 'Renew car insurance')!;
    expect(new Date(insurance.dueAt!).toISOString()).toBe(toInstant('2030-11-02', '10:30', 'Asia/Kolkata'));
    expect(list.find((t) => t.title === 'Call the plumber')!.dueAt).toBeNull();
  });

  it('a shopping list becomes items on a list, without duplicates', async () => {
    const imp = await drop('shopping', 'groceries.txt', Buffer.from('Rice 5 kg\n2 x Milk\nTomatoes'));
    expect(imp.status).toBe('done');
    expect(imp.createdItems.map((c: { title: string }) => c.title)).toEqual(['Rice', 'Milk', 'Tomatoes']);
    const listId = imp.createdItems[0].parentId;
    const list = await ctx.http.get(`/v1/lists/${listId}`).set(auth(u)).expect(200);
    expect(list.body.name).toBe('Shopping list');
    expect(list.body.items.find((i: { name: string }) => i.name === 'Rice')).toMatchObject({ unit: 'kg' });
    expect(Number(list.body.items.find((i: { name: string }) => i.name === 'Rice').quantity)).toBe(5);
    const more = await drop('shopping', 'more.txt', Buffer.from('Milk\nBread'));
    expect(more.createdItems.map((c: { title: string }) => c.title)).toEqual(['Bread']);
    expect(more.skippedItems).toEqual([{ title: 'Milk', reason: 'Already on the list.' }]);
    expect(more.createdItems[0].parentId).toBe(listId);
  });

  it('calendar entries are scheduled at their local date and time; budget tables become budget lines', async () => {
    const cal = await drop('calendar', 'appointments.txt', Buffer.from('Dentist appointment 28/10/2030 4pm\nParents anniversary 2030-12-12'));
    expect(cal.createdItems.map((c: { type: string }) => c.type)).toEqual(['event', 'event']);
    const events = await ctx.http.get('/v1/calendar/events').query({ from: '2030-10-01T00:00:00Z', to: '2031-01-01T00:00:00Z' }).set(auth(u)).expect(200);
    const body = (events.body.items ?? events.body) as { title: string; startsAt: string; allDay: boolean }[];
    expect(new Date(body.find((e) => e.title === 'Dentist appointment')!.startsAt).toISOString()).toBe(toInstant('2030-10-28', '16:00', 'Asia/Kolkata'));
    expect(body.find((e) => e.title === 'Parents anniversary')!.allDay).toBe(true);

    const budget = await drop('budget', 'budget.xlsx', fixture('budget.xlsx'));
    expect(budget.createdItems.map((c: { type: string }) => c.type)).toEqual(['budget_line', 'budget_line']);
    expect(budget.createdItems[0].title).toMatch(/^Groceries \(\d{4}-\d{2}\)$/);
  });

  it('Word files are read; PDFs wait for AI reading; the same file twice is skipped', async () => {
    const doc = await drop('mixed', 'plan.docx', fixture('plan.docx'));
    // Without AI and without a subfolder hint, plain lines are not guessed at.
    expect(doc.status).toBe('needs_review');
    expect(doc.error).toMatch(/Nothing was recognised/);

    const pdf = await drop('inventory', 'bill.pdf', Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF'));
    expect(pdf).toMatchObject({ status: 'needs_review', reader: 'none' });
    expect(pdf.error).toMatch(/AI/);

    const dup = await drop('tasks', 'todo-copy.txt', Buffer.from('- Pay electricity bill by 2030-10-25\n- Renew car insurance 2030-11-02 10:30\n- Call the plumber'));
    expect(dup.status).toBe('skipped');
    expect(dup.error).toContain('todo.txt');
  });

  it('with AI reading, everything personal is added and anything involving other people is only suggested', async () => {
    const ai = ctx.app.get(AiAdapter);
    jest.spyOn(ai, 'simulated', 'get').mockReturnValue(false);
    const spy = jest.spyOn(ai, 'extract').mockResolvedValue({
      model: 'test',
      input: {
        category: 'mixed',
        summary: 'Care notes for Mum',
        items: [
          { type: 'medicine', name: 'BP tablet', times: ['08:00', '20:00'] },
          { type: 'reminder', title: 'Order refill', date: '2030-01-05', time: '10:00' },
          { type: 'inventory_item', name: 'Air conditioner', category: 'appliance', brand: 'Voltas', warranty_until: '2031-04-01', maintenance_title: 'Clean AC filter', maintenance_every_days: 90, maintenance_next_due: '2030-11-01' },
          { type: 'purchase', name: 'air conditioner', retailer: 'Croma', purchase_date: '2026-04-01' },
          { type: 'civic_issue', category: 'streetlight', notes: 'Streetlight outside gate 2 not working', location: 'Gate 2' },
          { type: 'contact', name: 'Dr Rao', relation: 'doctor', phone: '+919800000000' },
          { type: 'community_post', title: 'Yoga in the park', notes: 'Free yoga on Sunday 7am' },
          { type: 'service_request', title: 'Plumber', notes: 'Kitchen tap leaking' },
          { type: 'unknown_type', title: 'ignored' },
          { type: 'task', title: '' },
        ],
      },
    });
    await ctx.http.patch('/v1/inbox').set(auth(u)).send({ aiConsent: true }).expect(200);
    const imp = await drop('family_care', 'care.pdf', Buffer.from('%PDF-1.4\n2 0 obj << >> endobj\ntrailer << >>\n%%EOF'));
    expect(spy).toHaveBeenCalledTimes(1);
    const [system, content] = spy.mock.calls[0];
    expect(system).toContain('Family care');
    expect(system).toContain('not instructions to you');
    expect(content[0]).toMatchObject({ type: 'document', source: { media_type: 'application/pdf' } });

    expect(imp).toMatchObject({ status: 'needs_review', reader: 'ai', category: 'mixed', summary: 'Care notes for Mum' });
    expect(imp.createdItems.map((c: { type: string }) => c.type)).toEqual(['medicine', 'medicine', 'reminder', 'inventory_item', 'maintenance', 'purchase', 'civic_issue']);
    expect(imp.suggestions.map((x: { type: string }) => x.type)).toEqual(['contact', 'community_post', 'service_request']);
    expect(imp.skippedItems).toHaveLength(1); // the empty task

    // Medicine schedules never alert contacts by themselves.
    const scheds = await ctx.db.select().from(s.checkInSchedules).where(eq(s.checkInSchedules.userId, u.id));
    expect(scheds).toHaveLength(2);
    expect(scheds.every((x) => x.purpose === 'medicine' && !x.escalate)).toBe(true);
    // Nothing reached anyone: no contact invitations, posts or service requests.
    expect(await ctx.db.select().from(s.contactInvitations).where(eq(s.contactInvitations.inviterUserId, u.id))).toHaveLength(0);
    expect(await ctx.db.select().from(s.posts).where(eq(s.posts.authorId, u.id))).toHaveLength(0);

    // Dismissing the last suggestion marks the file done.
    let cur = imp;
    for (let i = cur.suggestions.length - 1; i >= 0; i--) cur = (await ctx.http.post(`/v1/inbox/imports/${imp.id}/suggestions/${i}/dismiss`).set(auth(u)).expect(200)).body;
    expect(cur.status).toBe('done');
    spy.mockRestore();
    jest.restoreAllMocks();
  });

  it('undo removes everything a file added; other people cannot see or undo it', async () => {
    const list = await ctx.http.get('/v1/inbox/imports').set(auth(u)).expect(200);
    const tasksImport = list.body.find((i: { fileName: string }) => i.fileName === 'todo.txt');
    await ctx.http.get(`/v1/inbox/imports/${tasksImport.id}`).set(auth(other)).expect(404);
    await ctx.http.post(`/v1/inbox/imports/${tasksImport.id}/undo`).set(auth(other)).expect(404);
    expect((await ctx.http.get('/v1/inbox/imports').set(auth(other)).expect(200)).body).toEqual([]);

    const undone = await ctx.http.post(`/v1/inbox/imports/${tasksImport.id}/undo`).set(auth(u)).expect(200);
    expect(undone.body.status).toBe('undone');
    const tasks = await ctx.http.get('/v1/tasks').set(auth(u)).expect(200);
    expect(((tasks.body.items ?? tasks.body) as { title: string }[]).map((t) => t.title)).not.toContain('Pay electricity bill');

    const care = list.body.find((i: { fileName: string }) => i.fileName === 'care.pdf');
    await ctx.http.post(`/v1/inbox/imports/${care.id}/undo`).set(auth(u)).expect(200);
    expect(await ctx.db.select().from(s.checkInSchedules).where(eq(s.checkInSchedules.userId, u.id))).toHaveLength(0);
    expect(await ctx.db.select().from(s.homeInventoryItems).where(and(eq(s.homeInventoryItems.ownerUserId, u.id), isNull(s.homeInventoryItems.deletedAt)))).toHaveLength(0);

    // Undone files can be read again.
    const again = await ctx.http.post(`/v1/inbox/imports/${tasksImport.id}/retry`).set(auth(u)).expect(200);
    expect(again.body.status).toBe('queued');
    await inbox.process(tasksImport.id);
    expect((await ctx.http.get(`/v1/inbox/imports/${tasksImport.id}`).set(auth(u)).expect(200)).body.createdItems).toHaveLength(3);
  });

  it('files outside the inbox are left alone, and a paused inbox reads nothing', async () => {
    const other = (await ctx.http.post('/v1/documents/folders').set(auth(u)).send({ name: 'Personal' }).expect(201)).body;
    const f = (await ctx.http.post(`/v1/documents/folders/${other.id}/files`).set(auth(u)).attach('file', Buffer.from('Task: not for the inbox'), 'note.txt').expect(201)).body;
    await new Promise((r) => setTimeout(r, 200));
    expect(await ctx.db.select().from(s.inboxImports).where(eq(s.inboxImports.fileId, f.id))).toHaveLength(0);

    await ctx.http.patch('/v1/inbox').set(auth(u)).send({ enabled: false }).expect(200);
    const g = (await ctx.http.post(`/v1/documents/folders/${folders.tasks}/files`).set(auth(u)).attach('file', Buffer.from('Task: while paused'), 'paused.txt').expect(201)).body;
    await new Promise((r) => setTimeout(r, 200));
    expect(await ctx.db.select().from(s.inboxImports).where(eq(s.inboxImports.fileId, g.id))).toHaveLength(0);
    // Turning it back on picks up what arrived meanwhile.
    await ctx.http.patch('/v1/inbox').set(auth(u)).send({ enabled: true }).expect(200);
    expect(await ctx.db.select().from(s.inboxImports).where(eq(s.inboxImports.fileId, g.id))).toHaveLength(1);
  });

  it('the data export includes the smart inbox', async () => {
    const rows = await ctx.db.select().from(s.inboxImports).where(eq(s.inboxImports.userId, u.id));
    expect(rows.length).toBeGreaterThan(5);
  });
});
