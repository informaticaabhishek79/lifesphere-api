import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq } from 'drizzle-orm';
import type { Response } from 'express';
import { from, Observable, of } from 'rxjs';
import { catchError, map, mergeMap } from 'rxjs/operators';
import { Database, DB } from '../db/db';
import { idempotencyKeys } from '../db/schema';
import { AuthedRequest, IDEMPOTENT } from './auth-context';
import { AppError } from './errors';
import { CryptoService } from './crypto.service';

/**
 * For @Idempotent() routes: the client sends `Idempotency-Key`. A retry with the same key and body
 * returns the original response instead of performing the action twice (e.g. a help alert).
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly crypto: CryptoService,
    @Inject(DB) private readonly db: Database,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const enabled = this.reflector.getAllAndOverride<boolean>(IDEMPOTENT, [ctx.getHandler(), ctx.getClass()]);
    if (!enabled) return next.handle();
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length < 8 || key.length > 100) {
      throw new AppError(428, 'idempotency_key_required', 'Send an Idempotency-Key header (8-100 characters) with this request.');
    }
    const userId = req.actor?.userId;
    if (!userId) return next.handle();
    const path = req.originalUrl.split('?')[0];
    const requestHash = this.crypto.sha256(`${req.method}|${path}|${JSON.stringify(req.body ?? {})}`);

    return from(this.claim(userId, key, req.method, path, requestHash)).pipe(
      mergeMap((existing) => {
        if (existing) {
          res.status(existing.status);
          res.setHeader('Idempotent-Replay', 'true');
          return of(existing.body);
        }
        return next.handle().pipe(
          mergeMap((body) =>
            from(
              this.db
                .update(idempotencyKeys)
                .set({ responseStatus: res.statusCode, responseBody: (body ?? null) as object })
                .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key))),
            ).pipe(map(() => body)),
          ),
          catchError((err) => {
            return from(
              this.db.delete(idempotencyKeys).where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key))),
            ).pipe(
              mergeMap(() => {
                throw err;
              }),
            );
          }),
        );
      }),
    );
  }

  private async claim(userId: string, key: string, method: string, path: string, requestHash: string) {
    const inserted = await this.db
      .insert(idempotencyKeys)
      .values({ userId, key, method, path, requestHash, expiresAt: new Date(Date.now() + 24 * 3600_000) })
      .onConflictDoNothing()
      .returning({ id: idempotencyKeys.id });
    if (inserted.length) return null;
    const [row] = await this.db
      .select()
      .from(idempotencyKeys)
      .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, key)))
      .limit(1);
    if (!row) return null;
    if (row.requestHash !== requestHash || row.path !== path) {
      throw new AppError(422, 'idempotency_key_reused', 'This Idempotency-Key was already used for a different request.');
    }
    if (row.responseStatus == null) {
      throw new AppError(409, 'request_in_progress', 'The original request is still being processed.');
    }
    return { status: row.responseStatus, body: row.responseBody };
  }
}
