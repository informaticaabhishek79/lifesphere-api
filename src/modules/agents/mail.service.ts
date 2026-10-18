import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { and, eq, lt } from 'drizzle-orm';
import { Actor } from '../../common/auth-context';
import { AuditService } from '../../common/audit.service';
import { CryptoService } from '../../common/crypto.service';
import { AppError, notFound } from '../../common/errors';
import { Env, ENV } from '../../config/env';
import { Database, DB } from '../../db/db';
import { agents, mailAccounts, mailOauthStates } from '../../db/schema';
import { authUrl, DemoMail, exchangeCode, GmailMail, MailAccountRef, MailProvider, MailProviderName, MailTokens, OutlookMail, refreshTokens } from './mail.providers';

type Account = typeof mailAccounts.$inferSelect;

/**
 * Mailboxes a person connected. LifeSphere stores only the connection (encrypted tokens) and the address;
 * email content is fetched live when the person opens it and is never stored, except the text of a reply
 * an agent wrote (kept in the agent's activity log).
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly demo = new DemoMail();
  private readonly gmail = new GmailMail((a) => this.accessToken(a));
  private readonly outlook = new OutlookMail((a) => this.accessToken(a));

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
  ) {}

  get demoEnabled() {
    return this.env.MAIL_DEMO_ENABLED ?? this.env.NODE_ENV !== 'production';
  }

  providers() {
    return {
      demo: this.demoEnabled,
      gmail: !!this.env.GOOGLE_CLIENT_ID,
      outlook: !!this.env.MICROSOFT_CLIENT_ID,
    };
  }

  out(a: Account) {
    return { id: a.id, provider: a.provider, address: a.address, status: a.status, lastError: a.lastError, createdAt: a.createdAt };
  }

  private provider(name: MailProviderName): MailProvider {
    return name === 'gmail' ? this.gmail : name === 'outlook' ? this.outlook : this.demo;
  }

  private ref(a: Account): MailAccountRef {
    return { id: a.id, provider: a.provider, address: a.address, tokens: a.tokensEnc ? (JSON.parse(this.crypto.decrypt(a.tokensEnc)) as MailTokens) : null };
  }

  /** Current access token, refreshing (and saving) it when it has expired. */
  private async accessToken(ref: MailAccountRef): Promise<string> {
    if (!ref.tokens) throw new AppError(401, 'mail_reconnect', 'Reconnect this mailbox to continue.');
    if (ref.tokens.expiresAt > Date.now()) return ref.tokens.accessToken;
    try {
      const next = await refreshTokens(this.env, ref.provider as 'gmail' | 'outlook', ref.tokens);
      ref.tokens = next;
      await this.db.update(mailAccounts).set({ tokensEnc: this.crypto.encrypt(JSON.stringify(next)), status: 'active', lastError: null }).where(eq(mailAccounts.id, ref.id));
      return next.accessToken;
    } catch (e) {
      await this.db.update(mailAccounts).set({ status: 'reconnect', lastError: 'Sign-in expired' }).where(eq(mailAccounts.id, ref.id));
      throw e;
    }
  }

  async list(actor: Actor) {
    const rows = await this.db.select().from(mailAccounts).where(eq(mailAccounts.ownerUserId, actor.userId));
    return rows.map((a) => this.out(a));
  }

  async account(ownerId: string, id: string) {
    const [a] = await this.db.select().from(mailAccounts).where(and(eq(mailAccounts.id, id), eq(mailAccounts.ownerUserId, ownerId)));
    if (!a) throw notFound('Mailbox');
    return a;
  }

  async connectDemo(actor: Actor) {
    if (!this.demoEnabled) throw new AppError(409, 'demo_disabled', 'The sample mailbox is not available on this server.');
    const [existing] = await this.db.select().from(mailAccounts).where(and(eq(mailAccounts.ownerUserId, actor.userId), eq(mailAccounts.provider, 'demo')));
    if (existing) return this.out(existing);
    const [a] = await this.db.insert(mailAccounts).values({ ownerUserId: actor.userId, provider: 'demo', address: 'sample-inbox@lifesphere.local' }).returning();
    await this.audit.record(actor, { action: 'mail.connected', targetType: 'mail_account', targetId: a.id, metadata: { provider: 'demo' } });
    return this.out(a);
  }

  async startOauth(actor: Actor, provider: 'gmail' | 'outlook') {
    if (!this.providers()[provider]) throw new AppError(409, 'provider_not_configured', `${provider === 'gmail' ? 'Gmail' : 'Outlook'} connection is not set up on this server yet.`);
    await this.db.delete(mailOauthStates).where(lt(mailOauthStates.expiresAt, new Date()));
    const state = randomBytes(24).toString('hex');
    await this.db.insert(mailOauthStates).values({ state, userId: actor.userId, provider, expiresAt: new Date(Date.now() + 10 * 60_000) });
    return { url: authUrl(this.env, provider, state) };
  }

  /** OAuth callback (public). Returns where to send the browser next. */
  async finishOauth(provider: 'gmail' | 'outlook', code: string | undefined, state: string | undefined, error: string | undefined) {
    const back = (q: string) => `${this.env.APP_BASE_URL.replace(/\/$/, '')}/email?${q}`;
    if (!state) return back('error=state');
    const [s] = await this.db.delete(mailOauthStates).where(eq(mailOauthStates.state, state)).returning();
    if (!s || s.provider !== provider || s.expiresAt < new Date()) return back('error=expired');
    if (error || !code) return back('error=cancelled');
    try {
      const { tokens, address } = await exchangeCode(this.env, provider, code);
      const enc = this.crypto.encrypt(JSON.stringify({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt }));
      const [existing] = await this.db.select().from(mailAccounts).where(and(eq(mailAccounts.ownerUserId, s.userId), eq(mailAccounts.provider, provider), eq(mailAccounts.address, address)));
      const id = existing
        ? (await this.db.update(mailAccounts).set({ tokensEnc: enc, status: 'active', lastError: null }).where(eq(mailAccounts.id, existing.id)).returning())[0].id
        : (await this.db.insert(mailAccounts).values({ ownerUserId: s.userId, provider, address, tokensEnc: enc }).returning())[0].id;
      await this.audit.system({ action: 'mail.connected', targetType: 'mail_account', targetId: id, subjectUserId: s.userId, metadata: { provider } });
      return back(`connected=${id}`);
    } catch (e) {
      this.logger.warn(`Mail connect failed: ${(e as Error).message}`);
      return back('error=failed');
    }
  }

  async disconnect(actor: Actor, id: string) {
    const a = await this.account(actor.userId, id);
    // Best effort: tell Google to forget the permission too.
    if (a.provider === 'gmail' && a.tokensEnc) {
      const t = this.ref(a).tokens;
      if (t?.refreshToken) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t.refreshToken)}`, { method: 'POST' }).catch(() => undefined);
    }
    await this.db.update(agents).set({ mailAccountId: null }).where(eq(agents.mailAccountId, id));
    await this.db.delete(mailAccounts).where(eq(mailAccounts.id, id));
    await this.audit.record(actor, { action: 'mail.disconnected', targetType: 'mail_account', targetId: id, metadata: { provider: a.provider } });
  }

  async messages(ownerId: string, accountId: string, pageToken?: string) {
    const a = await this.account(ownerId, accountId);
    return this.provider(a.provider).list(this.ref(a), pageToken);
  }

  async message(ownerId: string, accountId: string, messageId: string) {
    const a = await this.account(ownerId, accountId);
    return this.provider(a.provider).get(this.ref(a), messageId);
  }

  async sendReply(ownerId: string, accountId: string, messageId: string, body: string) {
    const a = await this.account(ownerId, accountId);
    const p = this.provider(a.provider);
    const msg = await p.get(this.ref(a), messageId);
    const r = await p.reply(this.ref(a), msg, body);
    return { ...r, simulated: a.provider === 'demo' };
  }
}
