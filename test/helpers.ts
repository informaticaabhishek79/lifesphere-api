import { INestApplication } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { authenticator } from 'otplib';
import request from 'supertest';
import { createApp } from '../src/bootstrap';
import { Database, DB } from '../src/db/db';
import { runMigrations } from '../src/db/migrate';
import { runSeed } from '../src/db/seed';
import * as s from '../src/db/schema';

let phoneCounter = 0;

export interface TestUser {
  id: string;
  phone: string;
  token: string;
  refreshToken: string;
  sessionId: string;
  name: string;
}

export interface Ctx {
  app: INestApplication;
  db: Database;
  http: ReturnType<typeof request>;
}

/** Fresh schema state for every test file: migrate, wipe all data, seed reference data. */
export async function boot(): Promise<Ctx> {
  // Tests wipe every table. Refuse to run against anything that is not clearly a throwaway test database.
  const dbName = new URL(process.env.DATABASE_URL!).pathname.slice(1);
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to run tests against database "${dbName}". Tests delete all data; use a database whose name ends in _test (TEST_DATABASE_URL).`);
  }
  await runMigrations(process.env.DATABASE_URL);
  const app = await createApp({ logger: false });
  await app.init();
  const db = app.get<Database>(DB);
  const tables = await db.execute(
    sql`select table_schema, table_name from information_schema.tables where table_schema in ('public','auth') and table_type = 'BASE TABLE'`,
  );
  const list = (tables.rows as { table_schema: string; table_name: string }[]).map((t) => `"${t.table_schema}"."${t.table_name}"`).join(', ');
  if (list) await db.execute(sql.raw(`truncate ${list} restart identity cascade`));
  await runSeed([]);
  return { app, db, http: request(app.getHttpServer()) };
}

export async function shutdown(ctx: Ctx) {
  await ctx.app.close();
}

export function nextPhone() {
  phoneCounter++;
  const base = 9000000000 + ((Date.now() % 100000) * 1000 + phoneCounter) % 999999999;
  return `+91${String(base).slice(0, 10)}`;
}

/** Sign up (or sign in) through the real OTP flow. */
export async function signup(ctx: Ctx, name = 'Test User', phone = nextPhone()): Promise<TestUser> {
  const req = await ctx.http.post('/v1/auth/otp/request').send({ channel: 'sms', destination: phone }).expect(200);
  const res = await ctx.http
    .post('/v1/auth/otp/verify')
    .send({ challengeId: req.body.challengeId, code: req.body.devCode, displayName: name, ageConfirmed: true, acceptedPolicyVersion: '2026-10', deviceName: 'jest' })
    .expect(200);
  return { id: res.body.user.id, phone, token: res.body.accessToken, refreshToken: res.body.refreshToken, sessionId: res.body.sessionId, name };
}

export const auth = (u: { token: string }) => ({ Authorization: `Bearer ${u.token}` });

/** Re-authenticate a session (needed for sensitive routes) via SMS OTP. */
export async function reauth(ctx: Ctx, u: TestUser) {
  const r = await ctx.http.post('/v1/auth/reauth/request').set(auth(u)).send({ channel: 'sms' }).expect(200);
  await ctx.http.post('/v1/auth/reauth/verify').set(auth(u)).send({ challengeId: r.body.challengeId, code: r.body.devCode }).expect(200);
}

/** Make a user staff with the given roles and an MFA-verified session. */
export async function makeStaff(ctx: Ctx, u: TestUser, roles: (typeof s.staffRole.enumValues)[number][]) {
  for (const role of roles) await ctx.db.insert(s.staffRoles).values({ userId: u.id, role });
  const setup = await ctx.http.post('/v1/auth/mfa/totp/setup').set(auth(u)).expect(201);
  const confirm = await ctx.http.post('/v1/auth/mfa/totp/confirm').set(auth(u)).send({ code: authenticator.generate(setup.body.secret) }).expect(200);
  return { secret: setup.body.secret as string, recoveryCodes: confirm.body.recoveryCodes as string[] };
}

/** Grants become effective after the cooling-off window; tests skip the wait by moving effective_at back. */
export async function expireCooloff(ctx: Ctx) {
  await ctx.db.execute(sql`update access_grants set effective_at = now() - interval '1 minute' where status = 'pending_cooloff'`);
}

/** Make two users trusted contacts through the real invitation flow; optionally grant scopes from A to B. */
export async function connect(ctx: Ctx, a: TestUser, b: TestUser, scopesFromAtoB: string[] = []) {
  const inv = await ctx.http.post('/v1/contacts/invitations').set(auth(a)).send({ phone: b.phone, proposedScopes: scopesFromAtoB }).expect(201);
  await ctx.http.post(`/v1/contacts/invitations/${inv.body.id}/respond`).set(auth(b)).send({ accept: true }).expect(200);
  await expireCooloff(ctx);
}

export const idem = () => `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
