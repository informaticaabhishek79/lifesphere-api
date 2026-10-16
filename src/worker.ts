import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

/** Worker process: runs job handlers and schedules (registered by JobsService when PROCESS_ROLE=worker). */
export async function startWorker() {
  const ctx = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  ctx.useLogger(ctx.get(Logger));
  ctx.enableShutdownHooks();
  console.log('LifeSphere worker started');
}
