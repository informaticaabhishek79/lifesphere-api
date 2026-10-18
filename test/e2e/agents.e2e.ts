import { AgentsService } from '../../src/modules/agents/agents.service';
import { agents as agentsTable } from '../../src/db/schema';
import { eq } from 'drizzle-orm';
import { auth, boot, Ctx, shutdown, signup, TestUser } from '../helpers';

const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');

describe('Documents, and agents that only use what they are given', () => {
  let ctx: Ctx;
  let u: TestUser;
  let other: TestUser;
  const f: Record<string, string> = {};
  const file: Record<string, string> = {};

  beforeAll(async () => {
    ctx = await boot();
    u = await signup(ctx, 'Priya');
    other = await signup(ctx, 'Stranger');
    const mk = async (name: string, parentId?: string) => (await ctx.http.post('/v1/documents/folders').set(auth(u)).send({ name, parentId }).expect(201)).body.id as string;
    f.bills = await mk('Bills');
    f.bills2026 = await mk('2026', f.bills);
    f.recipes = await mk('Recipes');
    f.private = await mk('Private');
    const up = async (folder: string, name: string, body: Buffer) => (await ctx.http.post(`/v1/documents/folders/${folder}/files`).set(auth(u)).attach('file', body, name).expect(201)).body;
    file.bill = (await up(f.bills2026, 'electricity-october.txt', Buffer.from('City Power bill\nAmount due: 1,240\nDue date: 28 October 2026\n'))).id;
    file.photo = (await up(f.bills, 'meter.png', png)).id;
    file.recipe = (await up(f.recipes, 'dal.md', Buffer.from('# Dal\nLentils, turmeric, salt.'))).id;
    file.secret = (await up(f.private, 'diary.txt', Buffer.from('my private diary'))).id;
  });
  afterAll(() => shutdown(ctx));

  describe('documents', () => {
    it('lists folders with paths and counts, and reads text files', async () => {
      const r = await ctx.http.get('/v1/documents/folders').set(auth(u)).expect(200);
      expect(r.body.find((x: { id: string }) => x.id === f.bills2026)).toMatchObject({ path: 'Bills / 2026', fileCount: 1 });
      const t = await ctx.http.get(`/v1/documents/files/${file.bill}/text`).set(auth(u)).expect(200);
      expect(t.body.text).toContain('Amount due');
      const img = await ctx.http.get(`/v1/documents/files/${file.photo}`).set(auth(u)).expect(200);
      expect(img.body).toMatchObject({ mimeType: 'image/png', readableText: false });
    });

    it('rejects unknown binary files and checks type from content', async () => {
      const r = await ctx.http.post(`/v1/documents/folders/${f.bills}/files`).set(auth(u)).attach('file', Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]), 'setup.exe').expect(415);
      expect(r.body.code).toBe('file_type_not_allowed');
    });

    it('renames (keeping the extension), moves, bins and restores', async () => {
      const n = await ctx.http.post('/v1/documents/files/text').set(auth(u)).send({ folderId: f.recipes, name: 'shopping', content: 'milk' }).expect(201);
      expect(n.body.name).toBe('shopping.md');
      const r = await ctx.http.patch(`/v1/documents/files/${n.body.id}`).set(auth(u)).send({ name: 'weekly list' }).expect(200);
      expect(r.body.name).toBe('weekly list.md');
      await ctx.http.patch(`/v1/documents/files/${n.body.id}`).set(auth(u)).send({ folderId: f.bills }).expect(200);
      await ctx.http.delete(`/v1/documents/files/${n.body.id}`).set(auth(u)).expect(204);
      const bin = await ctx.http.get('/v1/documents/bin').set(auth(u)).expect(200);
      expect(bin.body.files.map((x: { id: string }) => x.id)).toContain(n.body.id);
      await ctx.http.post(`/v1/documents/files/${n.body.id}/restore`).set(auth(u)).expect(200);
      await ctx.http.delete(`/v1/documents/files/${n.body.id}`).set(auth(u)).expect(204);
    });

    it('binning a folder takes its contents along and restores them together', async () => {
      const tmp = (await ctx.http.post('/v1/documents/folders').set(auth(u)).send({ name: 'Old' }).expect(201)).body.id;
      const inner = (await ctx.http.post('/v1/documents/folders').set(auth(u)).send({ name: 'Inner', parentId: tmp }).expect(201)).body.id;
      const x = (await ctx.http.post('/v1/documents/files/text').set(auth(u)).send({ folderId: inner, name: 'a.txt', content: 'a' }).expect(201)).body.id;
      await ctx.http.delete(`/v1/documents/folders/${tmp}`).set(auth(u)).expect(204);
      await ctx.http.get(`/v1/documents/files/${x}`).set(auth(u)).expect(404);
      const bin = await ctx.http.get('/v1/documents/bin').set(auth(u)).expect(200);
      expect(bin.body.folders.map((b: { id: string }) => b.id)).toEqual(expect.arrayContaining([tmp]));
      expect(bin.body.folders.map((b: { id: string }) => b.id)).not.toContain(inner);
      await ctx.http.post(`/v1/documents/folders/${tmp}/restore`).set(auth(u)).expect(200);
      await ctx.http.get(`/v1/documents/files/${x}`).set(auth(u)).expect(200);
    });

    it('a folder cannot move inside itself', async () => {
      await ctx.http.patch(`/v1/documents/folders/${f.bills}`).set(auth(u)).send({ parentId: f.bills2026 }).expect(400);
    });

    it("other people cannot see anyone's documents", async () => {
      await ctx.http.get(`/v1/documents/files/${file.bill}`).set(auth(other)).expect(404);
      await ctx.http.get(`/v1/documents/files/${file.bill}/content`).set(auth(other)).expect(404);
      await ctx.http.get(`/v1/documents/folders/${f.bills}/files`).set(auth(other)).expect(404);
      await ctx.http.post(`/v1/documents/folders/${f.bills}/files`).set(auth(other)).attach('file', png, 'x.png').expect(404);
      const mine = await ctx.http.get('/v1/documents/folders').set(auth(other)).expect(200);
      expect(mine.body).toEqual([]);
    });
  });

  describe('documents agent', () => {
    let agent: string;

    beforeAll(async () => {
      const r = await ctx.http
        .post('/v1/agents')
        .set(auth(u))
        .send({
          kind: 'documents',
          name: 'Filing helper',
          folders: [
            { folderId: f.bills, access: 'edit' },
            { folderId: f.recipes, access: 'read' },
          ],
        })
        .expect(201);
      agent = r.body.id;
      expect(r.body.folders).toHaveLength(2);
    });

    const ask = (instruction: string, who = u) => ctx.http.post(`/v1/agents/${agent}/documents/run`).set(auth(who)).send({ instruction });

    it('sees only the granted folders (and the folders inside them)', async () => {
      const r = await ask('List my files').expect(200);
      expect(r.body.status).toBe('completed');
      expect(r.body.output).toContain('electricity-october.txt');
      expect(r.body.output).toContain('dal.md');
      expect(r.body.output).not.toContain('diary.txt');
      expect(r.body.actions.every((a: { tool: string }) => a.tool === 'list_folder')).toBe(true);
    });

    it('cannot read a file outside its folders', async () => {
      const r = await ask('Summarise diary.txt').expect(200);
      expect(r.body.output).toMatch(/couldn't find/);
    });

    it('reads and summarises files it may see', async () => {
      const r = await ask('Summarise electricity-october.txt').expect(200);
      expect(r.body.output).toContain('Amount due');
    });

    it('can change files only where it has edit access', async () => {
      const ro = await ask('Rename dal.md to lentils').expect(200);
      expect(ro.body.output).toMatch(/read-only/);
      const ok = await ask('Rename electricity-october.txt to Power bill October').expect(200);
      expect(ok.body.output).toContain('Power bill October.txt');
      const file1 = await ctx.http.get(`/v1/documents/files/${file.bill}`).set(auth(u)).expect(200);
      expect(file1.body).toMatchObject({ name: 'Power bill October.txt', lastChangedByAgentId: agent });
      const mk = await ask('Create folder Receipts').expect(200);
      expect(mk.body.output).toContain('Created the folder');
      const note = await ask('Create note Due dates: Electricity due 28 October').expect(200);
      expect(note.body.output).toContain('Created the note');
      const del = await ask('Delete meter.png').expect(200);
      expect(del.body.output).toContain('bin');
      await ctx.http.post(`/v1/documents/files/${file.photo}/restore`).set(auth(u)).expect(200);
    });

    it('enforces access on every tool call, whatever the model asks for', async () => {
      const svc = ctx.app.get(AgentsService);
      const [a] = await ctx.db.select().from(agentsTable).where(eq(agentsTable.id, agent));
      const scope = await svc.scope(a);
      expect(scope.can(f.bills2026, 'edit')).toBe(true);
      expect(scope.can(f.recipes, 'edit')).toBe(false);
      expect(scope.can(f.private, 'read')).toBe(false);
      for (const [tool, input] of [
        ['list_folder', { folder_id: f.private }],
        ['read_file', { file_id: file.secret }],
        ['delete_file', { file_id: file.secret }],
        ['rename_file', { file_id: file.secret, new_name: 'x' }],
        ['move_file', { file_id: file.bill, to_folder_id: f.private }],
        ['move_file', { file_id: file.secret, to_folder_id: f.bills }],
        ['create_text_file', { folder_id: f.private, name: 'x', content: 'y' }],
        ['create_folder', { parent_folder_id: f.private, name: 'x' }],
        ['rename_folder', { folder_id: f.private, new_name: 'x' }],
      ] as const) {
        const r = await svc.execTool(a, scope, tool, input as Record<string, unknown>);
        expect({ tool, ok: r.ok }).toEqual({ tool, ok: false });
      }
      const ro = await svc.execTool(a, scope, 'delete_file', { file_id: file.recipe });
      expect(ro).toMatchObject({ ok: false, note: 'Blocked: read-only folder' });
      // The private diary is untouched.
      const d = await ctx.http.get(`/v1/documents/files/${file.secret}`).set(auth(u)).expect(200);
      expect(d.body.name).toBe('diary.txt');
    });

    it('with a real model, tool requests outside the folders are refused and the refusal is logged', async () => {
      const { AiAdapter } = await import('../../src/adapters/ai');
      const ai = ctx.app.get(AiAdapter);
      const turns = [
        { content: [{ type: 'tool_use', id: 't1', name: 'read_file', input: { file_id: file.secret } }], stopReason: 'tool_use', model: 'fake' },
        { content: [{ type: 'tool_use', id: 't2', name: 'list_folder', input: { folder_id: f.bills } }], stopReason: 'tool_use', model: 'fake' },
        { content: [{ type: 'text', text: 'I could not open the diary; the Bills folder has 2 items.' }], stopReason: 'end_turn', model: 'fake' },
      ];
      const seen: unknown[] = [];
      const simulated = jest.spyOn(ai, 'simulated', 'get').mockReturnValue(false);
      const turn = jest.spyOn(ai, 'toolTurn').mockImplementation(async (_s, messages) => {
        seen.push(messages[messages.length - 1]);
        return turns.shift() as never;
      });
      try {
        const r = await ask('Read my diary').expect(200);
        expect(r.body.output).toContain('could not open');
        expect(r.body.actions).toEqual([
          expect.objectContaining({ tool: 'read_file', ok: false, note: 'Blocked: outside allowed folders' }),
          expect.objectContaining({ tool: 'list_folder', ok: true }),
        ]);
        // The model was told it has no access, and never received the diary text.
        expect(JSON.stringify(seen)).not.toContain('my private diary');
        expect(JSON.stringify(seen)).toContain('no access');
      } finally {
        simulated.mockRestore();
        turn.mockRestore();
      }
    });

    it('folders added later inside a granted folder are covered; removed grants stop access at once', async () => {
      const sub = (await ctx.http.post('/v1/documents/folders').set(auth(u)).send({ name: 'Water', parentId: f.bills }).expect(201)).body.id;
      await ctx.http.post('/v1/documents/files/text').set(auth(u)).send({ folderId: sub, name: 'water-bill.txt', content: 'Water bill 300' }).expect(201);
      expect((await ask('List my files').expect(200)).body.output).toContain('water-bill.txt');
      await ctx.http.patch(`/v1/agents/${agent}`).set(auth(u)).send({ folders: [{ folderId: f.recipes, access: 'read' }] }).expect(200);
      const after = await ask('List my files').expect(200);
      expect(after.body.output).not.toContain('water-bill.txt');
      expect(after.body.output).toContain('dal.md');
      await ctx.http.patch(`/v1/agents/${agent}`).set(auth(u)).send({ folders: [{ folderId: f.bills, access: 'edit' }, { folderId: f.recipes, access: 'read' }] }).expect(200);
    });

    it("cannot be given someone else's folder, or be used by someone else", async () => {
      const theirs = (await ctx.http.post('/v1/documents/folders').set(auth(other)).send({ name: 'Theirs' }).expect(201)).body.id;
      await ctx.http.patch(`/v1/agents/${agent}`).set(auth(u)).send({ folders: [{ folderId: theirs, access: 'edit' }] }).expect(404);
      await ask('List my files', other).expect(404);
      await ctx.http.get(`/v1/agents/${agent}/activity`).set(auth(other)).expect(404);
    });

    it('logs every request and the steps it took, without file contents', async () => {
      const log = await ctx.http.get(`/v1/agents/${agent}/activity`).set(auth(u)).expect(200);
      expect(log.body.length).toBeGreaterThan(5);
      const note = log.body.find((r: { request: string }) => r.request.startsWith('Create note'));
      const step = note.actions.find((a: { tool: string }) => a.tool === 'create_text_file');
      expect(step.input.content).toMatch(/characters/);
    });

    it('a paused agent does nothing; agents can be turned off in settings', async () => {
      await ctx.http.patch(`/v1/agents/${agent}`).set(auth(u)).send({ status: 'paused' }).expect(200);
      expect((await ask('List my files').expect(409)).body.code).toBe('agent_paused');
      await ctx.http.patch(`/v1/agents/${agent}`).set(auth(u)).send({ status: 'active' }).expect(200);
      await ctx.http.patch('/v1/me/preferences').set(auth(u)).send({ disabledFeatures: ['agents'] }).expect(200);
      expect((await ask('List my files').expect(409)).body.code).toBe('assistant_disabled');
      await ctx.http.patch('/v1/me/preferences').set(auth(u)).send({ disabledFeatures: [] }).expect(200);
    });
  });

  describe('email agent', () => {
    let mailbox: string;
    let agent: string;

    beforeAll(async () => {
      const p = await ctx.http.get('/v1/mail/providers').set(auth(u)).expect(200);
      expect(p.body).toEqual({ demo: true, gmail: false, outlook: false });
      mailbox = (await ctx.http.post('/v1/mail/accounts/demo').set(auth(u)).expect(201)).body.id;
      agent = (await ctx.http.post('/v1/agents').set(auth(u)).send({ kind: 'email', name: 'Mail helper', mailAccountId: mailbox, instructions: 'Keep it short.' }).expect(201)).body.id;
    });

    it('shows the inbox live and opens one email', async () => {
      const list = await ctx.http.get(`/v1/mail/accounts/${mailbox}/messages`).set(auth(u)).expect(200);
      expect(list.body.items.length).toBeGreaterThanOrEqual(5);
      const m = await ctx.http.get(`/v1/mail/accounts/${mailbox}/messages/demo-1`).set(auth(u)).expect(200);
      expect(m.body.subject).toContain('Plumber');
      expect(m.body.text).toContain('Saturday');
      await ctx.http.get(`/v1/mail/accounts/${mailbox}/messages`).set(auth(other)).expect(404);
    });

    it('replies to the chosen email when asked, and logs it', async () => {
      const r = await ctx.http.post(`/v1/agents/${agent}/email/reply`).set(auth(u)).send({ messageId: 'demo-1', instruction: 'Say Saturday 10 to 12 works for me' }).expect(200);
      expect(r.body).toMatchObject({ status: 'sent', targetRef: 'demo-1', simulated: true });
      expect(r.body.output).toContain('Saturday 10 to 12 works for me');
      expect(r.body.targetLabel).toContain('ravi@ravi-repairs.example');
      expect(r.body.actions.map((a: { tool: string }) => a.tool)).toEqual(['read_email', 'send_reply']);
    });

    it('can hold a reply for review, send an edited version, or discard it', async () => {
      const held = await ctx.http.post(`/v1/agents/${agent}/email/reply`).set(auth(u)).send({ messageId: 'demo-2', instruction: 'Yes we will come at 7:30', reviewFirst: true }).expect(200);
      expect(held.body.status).toBe('awaiting_approval');
      const sent = await ctx.http.post(`/v1/agents/activity/${held.body.id}/approve`).set(auth(u)).send({ body: 'Hi Meera, yes! See you at 7:30. Priya' }).expect(200);
      expect(sent.body).toMatchObject({ status: 'sent', output: 'Hi Meera, yes! See you at 7:30. Priya' });
      await ctx.http.post(`/v1/agents/activity/${held.body.id}/approve`).set(auth(u)).send({}).expect(409);

      await ctx.http.patch(`/v1/agents/${agent}`).set(auth(u)).send({ reviewBeforeSending: true }).expect(200);
      const held2 = await ctx.http.post(`/v1/agents/${agent}/email/reply`).set(auth(u)).send({ messageId: 'demo-3', instruction: 'Ask for the 10:00 slot' }).expect(200);
      expect(held2.body.status).toBe('awaiting_approval');
      await ctx.http.post(`/v1/agents/activity/${held2.body.id}/approve`).set(auth(other)).send({}).expect(404);
      expect((await ctx.http.post(`/v1/agents/activity/${held2.body.id}/discard`).set(auth(u)).expect(200)).body.status).toBe('discarded');
    });

    it('needs a mailbox, the right kind of agent, and an owner', async () => {
      const none = (await ctx.http.post('/v1/agents').set(auth(u)).send({ kind: 'email', name: 'No box' }).expect(201)).body.id;
      expect((await ctx.http.post(`/v1/agents/${none}/email/reply`).set(auth(u)).send({ messageId: 'demo-1', instruction: 'Hi' }).expect(409)).body.code).toBe('no_mailbox');
      expect((await ctx.http.post(`/v1/agents/${agent}/documents/run`).set(auth(u)).send({ instruction: 'List my files' }).expect(409)).body.code).toBe('wrong_agent');
      await ctx.http.post(`/v1/agents/${agent}/email/reply`).set(auth(other)).send({ messageId: 'demo-1', instruction: 'Hi' }).expect(404);
      const theirBox = (await ctx.http.post('/v1/mail/accounts/demo').set(auth(other)).expect(201)).body.id;
      await ctx.http.patch(`/v1/agents/${agent}`).set(auth(u)).send({ mailAccountId: theirBox }).expect(404);
      await ctx.http.delete(`/v1/agents/${none}`).set(auth(u)).expect(204);
      await ctx.http.get(`/v1/agents/${none}`).set(auth(u)).expect(404);
    });

    it('Gmail and Outlook stay unavailable until configured; bad OAuth callbacks go back with an error', async () => {
      expect((await ctx.http.post('/v1/mail/oauth/gmail/start').set(auth(u)).expect(409)).body.code).toBe('provider_not_configured');
      const cb = await ctx.http.get('/v1/mail/oauth/gmail/callback?code=x&state=forged').expect(302);
      expect(cb.headers.location).toBe('http://localhost:3000/email?error=expired');
    });

    it('everything is in the data export; disconnecting unlinks agents', async () => {
      const exp = await ctx.app.get((await import('../../src/modules/privacy/privacy.service')).PrivacyService).collectUserData(u.id);
      expect(exp.agents.length).toBeGreaterThanOrEqual(2);
      expect(exp.documentFiles.length).toBeGreaterThan(3);
      expect(exp.mailboxes[0]).not.toHaveProperty('tokensEnc');
      expect(exp.agentActivity.length).toBeGreaterThan(5);
      await ctx.http.delete(`/v1/mail/accounts/${mailbox}`).set(auth(u)).expect(204);
      const a = await ctx.http.get(`/v1/agents/${agent}`).set(auth(u)).expect(200);
      expect(a.body.mailbox).toBeNull();
    });
  });
});
