import { BadRequestException, INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { flattenValidationErrors } from './common/errors';
import { loadEnv } from './config/env';

export async function createApp(opts: { logger?: boolean } = {}): Promise<INestApplication> {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, logger: opts.logger === false ? false : undefined });
  if (opts.logger !== false) app.useLogger(app.get(Logger));
  if (env.TRUST_PROXY) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({ contentSecurityPolicy: env.NODE_ENV === 'production' ? undefined : false }));
  app.useBodyParser('json', { limit: '256kb' });
  app.enableCors({
    origin: env.CORS_ORIGINS.length ? env.CORS_ORIGINS : false,
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
    exposedHeaders: ['Idempotent-Replay'],
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      exceptionFactory: (errors) =>
        new BadRequestException({ code: 'validation_failed', detail: 'Some fields are invalid', errors: flattenValidationErrors(errors) }),
    }),
  );
  app.enableShutdownHooks();

  const config = new DocumentBuilder()
    .setTitle('LifeSphere API')
    .setDescription(
      'Privacy-first personal life management, family care, community and local assistance platform. ' +
        'All endpoints are versioned under /v1. Errors use RFC 9457 problem details (application/problem+json) with a stable `code`.',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  for (const path of Object.values(document.paths)) {
    for (const op of Object.values(path) as { security?: unknown[] }[]) op.security = op.security ?? [{ bearer: [] }];
  }
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs/openapi.json' });
  return app;
}
