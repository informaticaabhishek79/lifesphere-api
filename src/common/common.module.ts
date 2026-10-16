import { Global, Module } from '@nestjs/common';
import { AiAdapter, EmbeddingsAdapter } from '../adapters/ai';
import { EmailAdapter, PushAdapter, SmsAdapter } from '../adapters/messaging';
import { StorageAdapter } from '../adapters/storage';
import { NotificationsService } from '../modules/notifications/notifications.service';
import { AuditService } from './audit.service';
import { CryptoService } from './crypto.service';
import { PolicyService } from './policy.service';
import { QueueService } from './queue.service';
import { TokenService } from './token.service';

const providers = [
  CryptoService,
  TokenService,
  PolicyService,
  AuditService,
  QueueService,
  SmsAdapter,
  EmailAdapter,
  PushAdapter,
  StorageAdapter,
  AiAdapter,
  EmbeddingsAdapter,
  NotificationsService,
];

@Global()
@Module({ providers, exports: providers })
export class CommonModule {}
