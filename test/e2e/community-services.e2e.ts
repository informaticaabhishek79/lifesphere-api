import { sql } from 'drizzle-orm';
import { auth, boot, Ctx, makeStaff, shutdown, signup, TestUser } from '../helpers';

describe('Community, moderation, local services', () => {
  let ctx: Ctx;
  let owner: TestUser;
  let member: TestUser;
  let outsider: TestUser;
  let mod: TestUser;
  let mod2: TestUser;
  let reviewer: TestUser;
  let groupId: string;
  let privateGroupId: string;
  let localityId: string;

  beforeAll(async () => {
    ctx = await boot();
    owner = await signup(ctx, 'Group Owner');
    member = await signup(ctx, 'Member');
    outsider = await signup(ctx, 'Outsider');
    mod = await signup(ctx, 'Moderator');
    mod2 = await signup(ctx, 'Senior Moderator');
    reviewer = await signup(ctx, 'Provider Reviewer');
    await makeStaff(ctx, mod, ['moderator']);
    await makeStaff(ctx, mod2, ['moderator']);
    await makeStaff(ctx, reviewer, ['provider_reviewer']);
    const locs = await ctx.http.get('/v1/localities?search=Dwarka').set(auth(owner)).expect(200);
    localityId = locs.body[0].id;
    for (const u of [owner, member, outsider]) await ctx.http.patch('/v1/me/profile').set(auth(u)).send({ localityId }).expect(200);
  });
  afterAll(() => shutdown(ctx));

  it('groups: public join is instant, private needs approval, invite-only is hidden', async () => {
    groupId = (await ctx.http.post('/v1/community/groups').set(auth(owner)).send({ name: 'Dwarka Sector 6 Residents', visibility: 'public', localityId, category: 'apartment' }).expect(201)).body.id;
    privateGroupId = (await ctx.http.post('/v1/community/groups').set(auth(owner)).send({ name: 'Block C Seniors', visibility: 'private', localityId }).expect(201)).body.id;
    const hidden = (await ctx.http.post('/v1/community/groups').set(auth(owner)).send({ name: 'Committee', visibility: 'invite_only' }).expect(201)).body.id;

    expect((await ctx.http.post(`/v1/community/groups/${groupId}/join`).set(auth(member)).expect(200)).body.status).toBe('active');
    expect((await ctx.http.post(`/v1/community/groups/${privateGroupId}/join`).set(auth(member)).expect(200)).body.status).toBe('pending');
    await ctx.http.get(`/v1/community/groups/${privateGroupId}/posts`).set(auth(member)).expect(404);
    await ctx.http.patch(`/v1/community/groups/${privateGroupId}/members/${member.id}`).set(auth(owner)).send({ status: 'active' }).expect(200);
    await ctx.http.get(`/v1/community/groups/${privateGroupId}/posts`).set(auth(member)).expect(200);

    const discover = await ctx.http.get('/v1/community/groups').set(auth(outsider)).expect(200);
    expect(discover.body.items.map((g: { id: string }) => g.id)).not.toContain(hidden);
    await ctx.http.get(`/v1/community/groups/${hidden}`).set(auth(outsider)).expect(404);
    await ctx.http.post(`/v1/community/groups/${hidden}/join`).set(auth(outsider)).expect(403);
    // Member lists are only for members.
    await ctx.http.get(`/v1/community/groups/${groupId}/members`).set(auth(outsider)).expect(404);
  });

  it('posts: members only, address warning, feed includes local public groups', async () => {
    await ctx.http.post(`/v1/community/groups/${groupId}/posts`).set(auth(outsider)).send({ body: 'hi' }).expect(403);
    const p = await ctx.http.post(`/v1/community/groups/${groupId}/posts`).set(auth(member)).send({ kind: 'recommendation', body: 'Good plumber, he came to flat no 402 quickly' }).expect(201);
    expect(p.body.privacyWarning).toContain('home address');
    expect(p.body.heldForReview).toBe(false);
    const feed = await ctx.http.get('/v1/community/feed').set(auth(outsider)).expect(200);
    expect(feed.body.items.map((x: { id: string }) => x.id)).toContain(p.body.id);
    await ctx.http.post(`/v1/community/groups/${groupId}/posts`).set(auth(member)).send({ kind: 'announcement', body: 'x' }).expect(403);
    await ctx.http.post(`/v1/community/groups/${groupId}/posts`).set(auth(member)).send({ kind: 'event', body: 'Diwali meet' }).expect(400);
    const ev = await ctx.http.post(`/v1/community/groups/${groupId}/posts`).set(auth(owner)).send({ kind: 'event', title: 'Diwali meet', body: 'Join us', eventStartsAt: '2026-11-08T12:30:00Z', eventLocationText: 'Community hall' }).expect(201);
    expect(ev.body.kind).toBe('event');
  });

  it('comments, reactions, bookmarks, and blocking hides content both ways', async () => {
    const p = await ctx.http.post(`/v1/community/groups/${groupId}/posts`).set(auth(owner)).send({ body: 'Water supply off tomorrow 10-2' }).expect(201);
    await ctx.http.post(`/v1/community/groups/${groupId}/join`).set(auth(outsider)).expect(200);
    await ctx.http.post(`/v1/community/posts/${p.body.id}/comments`).set(auth(member)).send({ body: 'Thanks for sharing' }).expect(201);
    await ctx.http.put(`/v1/community/posts/${p.body.id}/reaction`).set(auth(member)).send({ kind: 'helpful' }).expect(200);
    await ctx.http.put(`/v1/community/posts/${p.body.id}/reaction`).set(auth(member)).send({ kind: 'thanks' }).expect(200);
    const full = await ctx.http.get(`/v1/community/posts/${p.body.id}`).set(auth(member)).expect(200);
    expect(full.body.reactionCount).toBe(1);
    expect(full.body.commentCount).toBe(1);
    expect(full.body.myReaction).toBe('thanks');
    await ctx.http.put(`/v1/community/posts/${p.body.id}/bookmark`).set(auth(member)).expect(200);
    expect((await ctx.http.get('/v1/community/bookmarks').set(auth(member)).expect(200)).body.items).toHaveLength(1);

    await ctx.http.put(`/v1/community/blocks/${owner.id}`).set(auth(outsider)).expect(200);
    await ctx.http.get(`/v1/community/posts/${p.body.id}`).set(auth(outsider)).expect(404);
    const feed = await ctx.http.get('/v1/community/feed').set(auth(outsider)).expect(200);
    expect(feed.body.items.some((x: { authorId: string }) => x.authorId === owner.id)).toBe(false);
    await ctx.http.get(`/v1/users/${outsider.id}/card`).set(auth(owner)).expect(404);
    await ctx.http.delete(`/v1/community/blocks/${owner.id}`).set(auth(outsider)).expect(204);
  });

  it('spam filter holds suspicious posts for review and creates a system report', async () => {
    const p = await ctx.http
      .post(`/v1/community/groups/${groupId}/posts`)
      .set(auth(member))
      .send({ body: 'Deals http://a.co http://b.co http://c.co http://d.co http://e.co http://f.co' })
      .expect(201);
    expect(p.body.heldForReview).toBe(true);
    await ctx.http.get(`/v1/community/posts/${p.body.id}`).set(auth(outsider)).expect(404);
    const q = await ctx.http.get('/v1/admin/moderation/reports').set(auth(mod)).expect(200);
    expect(q.body.items.some((r: { targetId: string; source: string }) => r.targetId === p.body.id && r.source === 'filter')).toBe(true);
  });

  it('reports → moderator review with evidence → removal → appeal decided by a different moderator', async () => {
    const bad = await ctx.http.post(`/v1/community/groups/${groupId}/posts`).set(auth(member)).send({ body: 'Abusive content aimed at neighbours' }).expect(201);
    await ctx.http.post('/v1/community/reports').set(auth(member)).send({ targetType: 'post', targetId: bad.body.id, reason: 'harassment' }).expect(400); // self report
    const r = await ctx.http.post('/v1/community/reports').set(auth(owner)).send({ targetType: 'post', targetId: bad.body.id, reason: 'harassment', details: 'Targets residents' }).expect(201);
    await ctx.http.post('/v1/community/reports').set(auth(owner)).send({ targetType: 'post', targetId: bad.body.id, reason: 'harassment' }).expect(409);
    // Author edits the post afterwards — the evidence snapshot keeps the original.
    await ctx.http.patch(`/v1/community/posts/${bad.body.id}`).set(auth(member)).send({ body: 'edited' }).expect(200);

    await ctx.http.get('/v1/admin/moderation/reports').set(auth(member)).expect(403);
    const detail = await ctx.http.get(`/v1/admin/moderation/reports/${r.body.id}`).set(auth(mod)).expect(200);
    expect(detail.body.evidence[0].snapshot.body).toBe('Abusive content aimed at neighbours');
    expect(detail.body.report.reporterId).toBeUndefined(); // reporter identity never shown
    await ctx.http.post(`/v1/admin/moderation/reports/${r.body.id}/assign`).set(auth(mod)).expect(200);
    const act = await ctx.http
      .post('/v1/admin/moderation/actions')
      .set(auth(mod))
      .send({ reportId: r.body.id, targetType: 'post', targetId: bad.body.id, action: 'remove', reason: 'Harassment of residents' })
      .expect(201);
    await ctx.http.get(`/v1/community/posts/${bad.body.id}`).set(auth(owner)).expect(404);

    const decisions = await ctx.http.get('/v1/community/moderation-decisions').set(auth(member)).expect(200);
    expect(decisions.body[0].id).toBe(act.body.id);
    const appeal = await ctx.http.post(`/v1/community/moderation-decisions/${act.body.id}/appeal`).set(auth(member)).send({ statement: 'This was a misunderstanding, please review' }).expect(201);
    const same = await ctx.http.post(`/v1/admin/moderation/appeals/${appeal.body.id}/decide`).set(auth(mod)).send({ decision: 'overturned', note: 'Looks fine' }).expect(403);
    expect(same.body.code).toBe('separation_of_duties');
    await ctx.http.post(`/v1/admin/moderation/appeals/${appeal.body.id}/decide`).set(auth(mod2)).send({ decision: 'overturned', note: 'Context shows no intent' }).expect(200);
    await ctx.http.get(`/v1/community/posts/${bad.body.id}`).set(auth(owner)).expect(200);
  });

  it('repeat offenders: posting suspension blocks new posts', async () => {
    const p = await ctx.http.post(`/v1/community/groups/${groupId}/posts`).set(auth(outsider)).send({ body: 'spam spam' }).expect(201);
    await ctx.http.post('/v1/admin/moderation/actions').set(auth(mod)).send({ targetType: 'post', targetId: p.body.id, action: 'suspend_posting', reason: 'Repeated spam', durationDays: 7 }).expect(201);
    const r = await ctx.http.post(`/v1/community/groups/${groupId}/posts`).set(auth(outsider)).send({ body: 'again' }).expect(403);
    expect(r.body.code).toBe('posting_restricted');
  });

  it('three independent reports auto-hide a post pending review', async () => {
    const p = await ctx.http.post(`/v1/community/groups/${groupId}/posts`).set(auth(owner)).send({ body: 'Questionable claim' }).expect(201);
    for (const u of [member, mod, mod2]) await ctx.http.post('/v1/community/reports').set(auth(u)).send({ targetType: 'post', targetId: p.body.id, reason: 'misinformation' }).expect(201);
    const [row] = (await ctx.db.execute(sql`select status from posts where id = ${p.body.id}`)).rows as { status: string }[];
    expect(row.status).toBe('hidden');
  });

  it('civic issues: user records the official reference; never auto-submitted', async () => {
    const c = await ctx.http.post('/v1/civic-issues').set(auth(member)).send({ category: 'garbage', description: 'Garbage not collected for 4 days', locationText: 'Near Sector 6 market' }).expect(201);
    expect(c.body.status).toBe('draft');
    expect(c.body.suggestedChannels.length).toBeGreaterThan(0);
    await ctx.http.patch(`/v1/civic-issues/${c.body.id}`).set(auth(member)).send({ status: 'reported_by_user' }).expect(400);
    const u = await ctx.http
      .patch(`/v1/civic-issues/${c.body.id}`)
      .set(auth(member))
      .send({ status: 'reported_by_user', officialChannelId: c.body.suggestedChannels[0].id, externalReference: 'MCD/2026/12345' })
      .expect(200);
    expect(u.body.externalReference).toBe('MCD/2026/12345');
    const shared = await ctx.http.post(`/v1/civic-issues/${c.body.id}/share`).set(auth(member)).send({ groupId }).expect(201);
    expect(shared.body.kind).toBe('civic_info');
  });

  it('providers: onboarding → review → approval; verification levels derived from checks; senior support needs screening', async () => {
    const cats = (await ctx.http.get('/v1/services/categories').set(auth(owner)).expect(200)).body;
    const plumbing = cats.find((c: { slug: string }) => c.slug === 'plumbing');
    const companion = cats.find((c: { slug: string }) => c.slug === 'senior-companionship');
    const prov = await ctx.http.post('/v1/provider-portal/providers').set(auth(owner)).send({ displayName: 'Ramesh Plumbing', providerType: 'individual', phonePublic: '+919811122233' }).expect(201);
    const pid = prov.body.id;
    await ctx.http.post(`/v1/provider-portal/providers/${pid}/submit`).set(auth(owner)).expect(422);
    await ctx.http.post(`/v1/provider-portal/providers/${pid}/services`).set(auth(owner)).send({ categoryId: plumbing.id, title: 'Leak repair', priceNote: 'Visit ₹300' }).expect(201);
    await ctx.http.post(`/v1/provider-portal/providers/${pid}/services`).set(auth(owner)).send({ categoryId: companion.id, title: 'Companion visits' }).expect(201);
    await ctx.http.put(`/v1/provider-portal/providers/${pid}/areas`).set(auth(owner)).send({ localityIds: [localityId] }).expect(200);
    await ctx.http.post(`/v1/provider-portal/providers/${pid}/submit`).set(auth(owner)).expect(200);
    // Not in the directory until approved.
    expect((await ctx.http.get('/v1/services/providers').set(auth(member)).expect(200)).body.items).toHaveLength(0);
    await ctx.http.post(`/v1/admin/providers/${pid}/decision`).set(auth(reviewer)).send({ decision: 'approve' }).expect(200);
    const dir = await ctx.http.get(`/v1/services/providers?categoryId=${plumbing.id}`).set(auth(member)).expect(200);
    expect(dir.body.items[0].verificationLabel).toBe('Not verified by LifeSphere');

    // Cannot record ID numbers in verification notes.
    await ctx.http.post(`/v1/admin/providers/${pid}/verification`).set(auth(reviewer)).send({ checkType: 'identity', status: 'passed', note: 'Aadhaar 1234 5678 9012' }).expect(400);
    const v1 = await ctx.http.post(`/v1/admin/providers/${pid}/verification`).set(auth(reviewer)).send({ checkType: 'identity', status: 'passed', note: 'Checked in person' }).expect(201);
    expect(v1.body.verificationLevel).toBe('basic');

    // Senior companionship request refused until background screened.
    const refused = await ctx.http.post('/v1/service-requests').set(auth(member)).send({ categoryId: companion.id, providerId: pid, title: 'Visit my mother weekly' }).expect(422);
    expect(refused.body.code).toBe('verification_required');
    const v2 = await ctx.http.post(`/v1/admin/providers/${pid}/verification`).set(auth(reviewer)).send({ checkType: 'background', status: 'passed', performedByPartner: 'Partner Agency' }).expect(201);
    expect(v2.body.verificationLevel).toBe('screened');
    await ctx.http.post('/v1/service-requests').set(auth(member)).send({ categoryId: companion.id, providerId: pid, title: 'Visit my mother weekly' }).expect(201);
  });

  it('service request lifecycle with audited history, hidden address until accepted, and review', async () => {
    const cats = (await ctx.http.get('/v1/services/categories').set(auth(member)).expect(200)).body;
    const plumbing = cats.find((c: { slug: string }) => c.slug === 'plumbing');
    const [prov] = (await ctx.http.get('/v1/provider-portal/providers').set(auth(owner)).expect(200)).body;
    const pid = prov.provider.id;
    // Open request (no provider chosen): providers in the area see it without the address.
    const req = await ctx.http.post('/v1/service-requests').set(auth(member)).send({ categoryId: plumbing.id, title: 'Kitchen tap leaking', locationNote: 'House 12, Lane 3' }).expect(201);
    const open = await ctx.http.get(`/v1/provider-portal/providers/${pid}/open-requests`).set(auth(owner)).expect(200);
    const listed = open.body.find((r: { id: string }) => r.id === req.body.id);
    expect(listed).toBeDefined();
    expect(listed.locationNote).toBeUndefined();
    await ctx.http.post(`/v1/provider-portal/providers/${pid}/open-requests/${req.body.id}/claim`).set(auth(owner)).expect(200);
    const asProvider = await ctx.http.get(`/v1/service-requests/${req.body.id}`).set(auth(owner)).expect(200);
    expect(asProvider.body.locationNote).toBe('House 12, Lane 3');

    await ctx.http.post(`/v1/service-requests/${req.body.id}/status`).set(auth(member)).send({ status: 'completed' }).expect(422); // customer cannot complete
    await ctx.http.post(`/v1/service-requests/${req.body.id}/status`).set(auth(owner)).send({ status: 'scheduled' }).expect(400);
    await ctx.http.post(`/v1/service-requests/${req.body.id}/status`).set(auth(owner)).send({ status: 'scheduled', scheduledAt: '2026-10-20T05:30:00Z' }).expect(200);
    await ctx.http.post(`/v1/service-requests/${req.body.id}/status`).set(auth(owner)).send({ status: 'in_progress' }).expect(200);
    await ctx.http.post(`/v1/service-requests/${req.body.id}/review`).set(auth(member)).send({ rating: 5 }).expect(422);
    await ctx.http.post(`/v1/service-requests/${req.body.id}/status`).set(auth(owner)).send({ status: 'completed' }).expect(200);
    await ctx.http.post(`/v1/service-requests/${req.body.id}/review`).set(auth(member)).send({ rating: 5, body: 'Quick and tidy' }).expect(201);
    await ctx.http.post(`/v1/service-requests/${req.body.id}/review`).set(auth(member)).send({ rating: 1 }).expect(409);
    const final = await ctx.http.get(`/v1/service-requests/${req.body.id}`).set(auth(member)).expect(200);
    expect(final.body.history.map((h: { toStatus: string }) => h.toStatus)).toEqual(['requested', 'accepted', 'scheduled', 'in_progress', 'completed']);
    await ctx.http.get(`/v1/service-requests/${req.body.id}`).set(auth(outsider)).expect(404);
  });

  it('sponsored listings are disclosed and never shown as verification', async () => {
    const super1 = await signup(ctx, 'Super');
    await makeStaff(ctx, super1, ['super_admin']);
    const [prov] = (await ctx.http.get('/v1/provider-portal/providers').set(auth(owner)).expect(200)).body;
    await ctx.http.put(`/v1/admin/providers/${prov.provider.id}/sponsorship`).set(auth(super1)).send({ isSponsored: true }).expect(200);
    const d = await ctx.http.get(`/v1/services/providers/${prov.provider.id}`).set(auth(member)).expect(200);
    expect(d.body.sponsored).toBe(true);
    expect(d.body.sponsoredDisclosure).toContain('does not affect verification');
  });
});
