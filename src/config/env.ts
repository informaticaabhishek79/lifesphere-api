import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const csv = z
  .string()
  .default('')
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().default(4000),
    /** Process role: api serves HTTP; worker runs background jobs; both runs everything in one process (dev only). */
    PROCESS_ROLE: z.enum(['api', 'worker', 'both']).default('api'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    TRUST_PROXY: bool.default(true),
    APP_BASE_URL: z.string().url().default('http://localhost:3008'),
    API_BASE_URL: z.string().url().default('http://localhost:4000'),
    CORS_ORIGINS: csv,

    DATABASE_URL: z.string().min(1),
    /** Non-pooled endpoint for migrations and the job queue (Neon: the URL without -pooler). */
    DATABASE_DIRECT_URL: z.string().optional(),
    DATABASE_POOL_MAX: z.coerce.number().int().default(10),
    DATABASE_SSL: bool.default(false),

    JWT_SECRET: z.string().min(32),
    JWT_ISSUER: z.string().default('lifesphere-api'),
    JWT_AUDIENCE: z.string().default('lifesphere'),
    ACCESS_TOKEN_TTL_SEC: z.coerce.number().int().default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().default(30),
    /** Secret used to HMAC phone numbers, emails, IPs, OTP codes and tokens. */
    HASH_PEPPER: z.string().min(32),
    /** 32-byte key (base64) for AES-256-GCM encryption of MFA secrets. */
    ENCRYPTION_KEY: z.string().min(40),

    OTP_TTL_SEC: z.coerce.number().int().default(300),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().default(5),
    /** Development only: include the OTP code in the API response. Refused in production. */
    OTP_DEV_ECHO: bool.default(false),
    /** Development only: accept this fixed OTP for any destination. Refused in production. */
    OTP_DEV_FIXED_CODE: z.string().optional(),
    OTP_MAX_PER_DESTINATION_HOUR: z.coerce.number().int().default(5),
    OTP_MAX_PER_IP_HOUR: z.coerce.number().int().default(30),

    /** Time zone for the daily background jobs (maintenance reminders, retention). Per-user notifications still respect each person's quiet hours. */
    JOBS_TIMEZONE: z.string().default('UTC'),
    GRANT_COOLOFF_MINUTES: z.coerce.number().int().min(0).default(10),
    STAFF_REQUIRE_MFA: bool.default(true),

    /** mock | msg91 (India) | twilio (worldwide) | routed (+91 via MSG91, everything else via Twilio) */
    SMS_PROVIDER: z.enum(['mock', 'msg91', 'twilio', 'routed']).default('mock'),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_FROM: z.string().optional(),
    TWILIO_MESSAGING_SERVICE_SID: z.string().optional(),
    MSG91_AUTH_KEY: z.string().optional(),
    MSG91_SENDER_ID: z.string().optional(),
    MSG91_OTP_TEMPLATE_ID: z.string().optional(),
    MSG91_ALERT_TEMPLATE_ID: z.string().optional(),
    /** Shared secret expected on delivery-report webhooks (?token=...). */
    WEBHOOK_SECRET: z.string().min(16).default('change-me-webhook-secret'),

    EMAIL_PROVIDER: z.enum(['mock', 'resend']).default('mock'),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().default('LifeSphere <no-reply@lifesphere.local>'),

    PUSH_PROVIDER: z.enum(['mock', 'fcm']).default('mock'),
    FCM_PROJECT_ID: z.string().optional(),
    /** Service account JSON (single line) with firebase messaging scope. */
    FCM_SERVICE_ACCOUNT_JSON: z.string().optional(),
    WEBPUSH_VAPID_PUBLIC_KEY: z.string().optional(),
    WEBPUSH_VAPID_PRIVATE_KEY: z.string().optional(),
    WEBPUSH_SUBJECT: z.string().default('mailto:privacy@lifesphere.local'),

    STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('./.storage'),
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().default('auto'),
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    UPLOAD_MAX_BYTES: z.coerce.number().int().default(5 * 1024 * 1024),

    AI_PROVIDER: z.enum(['mock', 'anthropic']).default('mock'),
    ANTHROPIC_API_KEY: z.string().optional(),
    AI_MODEL: z.string().default('claude-sonnet-5-5'),
    EMBEDDINGS_PROVIDER: z.enum(['none', 'openai']).default('none'),
    EMBEDDINGS_API_KEY: z.string().optional(),
    EMBEDDINGS_MODEL: z.string().default('text-embedding-3-small'),
    EMBEDDINGS_DIMENSIONS: z.coerce.number().int().default(1536),

    /** Gmail connection (Google Cloud OAuth client, "Web application"). Redirect URI: API_BASE_URL/v1/mail/oauth/gmail/callback */
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    /** Outlook connection (Microsoft Entra app). Redirect URI: API_BASE_URL/v1/mail/oauth/outlook/callback */
    MICROSOFT_CLIENT_ID: z.string().optional(),
    MICROSOFT_CLIENT_SECRET: z.string().optional(),
    MICROSOFT_TENANT: z.string().default('common'),
    /** Offer a sample mailbox so agents can be tried without connecting a real one. Off in production by default. */
    MAIL_DEMO_ENABLED: bool.optional(),
    DOCUMENT_MAX_BYTES: z.coerce.number().int().default(20 * 1024 * 1024),
    /** Text kept per file for agents to read (characters). */
    DOCUMENT_TEXT_MAX_CHARS: z.coerce.number().int().default(200_000),
    AGENT_RUN_RETENTION_DAYS: z.coerce.number().int().default(90),

    PRIVACY_REQUEST_SLA_DAYS: z.coerce.number().int().default(30),
    ACCOUNT_DELETION_GRACE_DAYS: z.coerce.number().int().default(7),
    SOFT_DELETE_PURGE_DAYS: z.coerce.number().int().default(30),
    AUDIT_RETENTION_DAYS: z.coerce.number().int().default(365),
    EVIDENCE_RETENTION_DAYS: z.coerce.number().int().default(180),
    AI_HISTORY_RETENTION_DAYS: z.coerce.number().int().default(30),

    /** URL the worker pings every minute (e.g. healthchecks.io); missing pings page the operator. */
    WORKER_HEARTBEAT_URL: z.string().optional(),

    RATE_LIMIT_PER_MINUTE: z.coerce.number().int().default(120),
    /** Tests only: disable HTTP rate limiting. Refused in production. */
    THROTTLE_DISABLED: bool.default(false),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      if (env.OTP_DEV_ECHO) ctx.addIssue({ code: 'custom', path: ['OTP_DEV_ECHO'], message: 'must be false in production' });
      if (env.OTP_DEV_FIXED_CODE)
        ctx.addIssue({ code: 'custom', path: ['OTP_DEV_FIXED_CODE'], message: 'must not be set in production' });
      if (env.WEBHOOK_SECRET === 'change-me-webhook-secret')
        ctx.addIssue({ code: 'custom', path: ['WEBHOOK_SECRET'], message: 'set a real secret in production' });
      if (env.THROTTLE_DISABLED)
        ctx.addIssue({ code: 'custom', path: ['THROTTLE_DISABLED'], message: 'must be false in production' });
      if (env.PROCESS_ROLE === 'both')
        ctx.addIssue({ code: 'custom', path: ['PROCESS_ROLE'], message: 'run api and worker as separate processes in production' });
    }
    if ((env.SMS_PROVIDER === 'msg91' || env.SMS_PROVIDER === 'routed') && !env.MSG91_AUTH_KEY)
      ctx.addIssue({ code: 'custom', path: ['MSG91_AUTH_KEY'], message: `required when SMS_PROVIDER=${env.SMS_PROVIDER}` });
    if ((env.SMS_PROVIDER === 'twilio' || env.SMS_PROVIDER === 'routed') && !(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && (env.TWILIO_FROM || env.TWILIO_MESSAGING_SERVICE_SID)))
      ctx.addIssue({ code: 'custom', path: ['TWILIO_ACCOUNT_SID'], message: `Twilio account SID, auth token and a sender are required when SMS_PROVIDER=${env.SMS_PROVIDER}` });
    if (!!env.GOOGLE_CLIENT_ID !== !!env.GOOGLE_CLIENT_SECRET)
      ctx.addIssue({ code: 'custom', path: ['GOOGLE_CLIENT_SECRET'], message: 'set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither' });
    if (!!env.MICROSOFT_CLIENT_ID !== !!env.MICROSOFT_CLIENT_SECRET)
      ctx.addIssue({ code: 'custom', path: ['MICROSOFT_CLIENT_SECRET'], message: 'set both MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET, or neither' });
    if (env.EMAIL_PROVIDER === 'resend' && !env.RESEND_API_KEY)
      ctx.addIssue({ code: 'custom', path: ['RESEND_API_KEY'], message: 'required when EMAIL_PROVIDER=resend' });
    if (env.PUSH_PROVIDER === 'fcm' && !env.FCM_SERVICE_ACCOUNT_JSON)
      ctx.addIssue({ code: 'custom', path: ['FCM_SERVICE_ACCOUNT_JSON'], message: 'required when PUSH_PROVIDER=fcm' });
    if (env.STORAGE_PROVIDER === 's3' && !(env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY))
      ctx.addIssue({ code: 'custom', path: ['S3_BUCKET'], message: 'S3 bucket and credentials required when STORAGE_PROVIDER=s3' });
    if (env.AI_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY)
      ctx.addIssue({ code: 'custom', path: ['ANTHROPIC_API_KEY'], message: 'required when AI_PROVIDER=anthropic' });
    if (env.EMBEDDINGS_PROVIDER === 'openai' && !env.EMBEDDINGS_API_KEY)
      ctx.addIssue({ code: 'custom', path: ['EMBEDDINGS_API_KEY'], message: 'required when EMBEDDINGS_PROVIDER=openai' });
    if (Buffer.from(env.ENCRYPTION_KEY, 'base64').length !== 32)
      ctx.addIssue({ code: 'custom', path: ['ENCRYPTION_KEY'], message: 'must be 32 bytes, base64-encoded' });
  });

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached && source === process.env) return cached;
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}\n\nFix: run \`npm run setup\` to create .env and generate the secrets, then set DATABASE_URL.`);
  }
  if (source === process.env) cached = parsed.data;
  return parsed.data;
}

export function resetEnvCache() {
  cached = null;
}

export const ENV = Symbol('ENV');
