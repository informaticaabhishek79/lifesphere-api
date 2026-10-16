import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { Env, ENV } from '../config/env';
import { Database, DB } from '../db/db';
import { sessions, staffRoles, users } from '../db/schema';
import { Actor, AuthedRequest, IS_PUBLIC, RECENT_AUTH, STAFF_ROLES, StaffRoleName } from './auth-context';
import { CryptoService } from './crypto.service';
import { AppError, forbidden } from './errors';
import { TokenService } from './token.service';

/**
 * Global guard: every route requires a valid, unrevoked session unless marked @Public().
 * Also enforces @StaffOnly (role + MFA) and @RequireRecentAuth.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    private readonly crypto: CryptoService,
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;

    if (!token) {
      if (isPublic) return true;
      throw new UnauthorizedException({ code: 'unauthenticated', detail: 'Sign in to continue' });
    }

    const claims = await this.tokens.verifyAccess(token);
    if (!claims) {
      if (isPublic) return true;
      throw new UnauthorizedException({ code: 'token_invalid', detail: 'Your session has expired. Please sign in again.' });
    }

    const [row] = await this.db
      .select({
        sessionId: sessions.id,
        userId: sessions.userId,
        amr: sessions.amr,
        mfaVerifiedAt: sessions.mfaVerifiedAt,
        reauthAt: sessions.reauthAt,
        createdAt: sessions.createdAt,
        lastUsedAt: sessions.lastUsedAt,
        status: users.status,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.id, claims.sid),
          eq(sessions.userId, claims.sub),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!row || !['active', 'pending_deletion'].includes(row.status)) {
      if (isPublic) return true;
      throw new UnauthorizedException({ code: 'session_revoked', detail: 'Your session is no longer valid. Please sign in again.' });
    }

    const staff = await this.db
      .select({ role: staffRoles.role })
      .from(staffRoles)
      .where(and(eq(staffRoles.userId, row.userId), isNull(staffRoles.revokedAt)));

    const ip = req.ip ?? '';
    const actor: Actor = {
      userId: row.userId,
      sessionId: row.sessionId,
      amr: row.amr,
      mfaVerified: !!row.mfaVerifiedAt,
      sessionCreatedAt: row.createdAt,
      reauthAt: row.reauthAt,
      staffRoles: staff.map((s) => s.role as StaffRoleName),
      ipHash: ip ? this.crypto.hmac(ip, 'ip') : null,
    };
    req.actor = actor;

    // Touch the session at most once every 5 minutes.
    if (Date.now() - row.lastUsedAt.getTime() > 5 * 60_000) {
      const now = new Date();
      void this.db.update(sessions).set({ lastUsedAt: now }).where(eq(sessions.id, row.sessionId)).catch(() => undefined);
      void this.db.update(users).set({ lastActiveAt: now }).where(eq(users.id, row.userId)).catch(() => undefined);
    }

    const requiredStaff = this.reflector.getAllAndOverride<StaffRoleName[] | undefined>(STAFF_ROLES, targets);
    if (requiredStaff) {
      const isSuper = actor.staffRoles.includes('super_admin');
      const ok =
        isSuper ||
        (requiredStaff.length === 0 ? actor.staffRoles.length > 0 : requiredStaff.some((r) => actor.staffRoles.includes(r)));
      if (!ok) throw forbidden('This area is restricted to authorised staff.', 'staff_only');
      if (this.env.STAFF_REQUIRE_MFA && !actor.mfaVerified) {
        throw new AppError(403, 'mfa_required', 'Staff access requires two-factor authentication on this session.');
      }
    }

    const recentMinutes = this.reflector.getAllAndOverride<number | undefined>(RECENT_AUTH, targets);
    if (recentMinutes) {
      const last = Math.max(actor.sessionCreatedAt.getTime(), actor.reauthAt?.getTime() ?? 0);
      if (Date.now() - last > recentMinutes * 60_000) {
        throw new AppError(403, 'reauth_required', 'Please confirm it is you before making this change.');
      }
    }
    return true;
  }
}
