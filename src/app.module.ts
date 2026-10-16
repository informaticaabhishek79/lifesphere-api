import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AuthGuard } from './common/auth.guard';
import { CommonModule } from './common/common.module';
import { ProblemDetailsFilter } from './common/errors';
import { IdempotencyInterceptor } from './common/idempotency.interceptor';
import { loadEnv } from './config/env';
import { DbModule } from './db/db';
import { FEATURE_CONTROLLERS, FEATURE_PROVIDERS } from './modules';

const env = loadEnv();

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: env.LOG_LEVEL,
        transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
        // Privacy: never log bodies, auth headers, cookies or query strings (may carry tokens/personal data).
        redact: {
          paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["idempotency-key"]', 'res.headers["set-cookie"]'],
          censor: '[redacted]',
        },
        serializers: {
          req: (req: { id: string; method: string; url: string }) => ({ id: req.id, method: req.method, path: req.url?.split('?')[0] }),
          res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
        },
        autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/v1/health') },
        customProps: () => ({ service: 'lifesphere-api' }),
      },
    }),
    ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60_000, limit: env.RATE_LIMIT_PER_MINUTE }], skipIf: () => env.THROTTLE_DISABLED }),
    DbModule,
    CommonModule,
  ],
  controllers: FEATURE_CONTROLLERS,
  providers: [
    ...FEATURE_PROVIDERS,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
})
export class AppModule {}
