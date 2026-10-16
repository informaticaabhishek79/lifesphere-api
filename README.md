# LifeSphere — API

Privacy-first personal life management, family care, community and local assistance platform.
This repository is the **backend**: the API and its background worker. The web app lives in its own repository, **lifesphere-web**; the Android app follows.

**Web app:** start this API as below, then follow the README in the lifesphere-web repository (it runs on `http://localhost:3008`).

**Changing the API?** Run `npm run openapi` and commit `openapi.json`; the web repo copies it with `npm run api:pull`.

| | |
|---|---|
| Stack | Node 22, NestJS 11, TypeScript, PostgreSQL 15+ (Drizzle ORM), pg-boss job queue |
| API | 312 operations on 232 paths, versioned under `/v1`, OpenAPI at `/docs` |
| Database | 86 tables (82 `public`, 4 `auth`), 2 migrations, idempotent seed |
| Tests | 118 automated tests in 7 suites, run against a real Postgres |
| Processes | `api` (HTTP) and `worker` (reminders, check-in escalation, notifications, exports, deletion, retention) |

## Run it locally (Windows, macOS, Linux)

You need Node 22+ and PostgreSQL 15+ (local install, `docker compose up -d postgres`, or a free Neon database).

```bash
cd lifesphere-api
npm ci
npm run setup -- --db=postgres://USER:PASSWORD@HOST:5432/lifesphere   # creates .env and generates all secrets
npm run db:migrate
npm run db:seed -- --admin=+919999900001   # optional: makes that phone a super admin
npm run dev:all                            # API + worker together on http://localhost:4000
```

`npm run setup` never overwrites secrets you already set; run it again any time. Without `--db` it keeps the `DATABASE_URL` in `.env`.

Open `http://localhost:4000/docs`. In development `OTP_DEV_ECHO=true` returns the sign-in code in the response (`devCode`), and every SMS, email, push and AI call is **simulated** and labelled as such (`GET /v1/health/ready` lists which integrations are simulated).

Sign in: `POST /v1/auth/otp/request` → `POST /v1/auth/otp/verify` (new accounts send `displayName`, `ageConfirmed: true`, `acceptedPolicyVersion`). Use the `accessToken` as `Authorization: Bearer …`; refresh with `POST /v1/auth/refresh` (tokens rotate; reuse of an old refresh token signs every device out).

## Scripts

| Script | What it does |
|---|---|
| `npm run setup` | Create `.env` and generate secrets (`-- --db=<url>` also sets the database) |
| `npm run dev` / `dev:all` / `dev:worker` | API only / API + worker / worker only, from source |
| `npm run build` | Compile to `dist/` (migrations copied in) |
| `npm start` / `npm run start:worker` | Run built API / worker |
| `npm run db:generate` | Create a migration after editing `src/db/schema/*` |
| `npm run db:migrate` / `db:migrate:prod` | Apply migrations (source / built) |
| `npm run db:seed` | Localities, service categories, official channels, starter guidance, plans |
| `npm run openapi` | Write `openapi.json` and regenerate `docs/API_ENDPOINTS.md` |
| `npm test` | Unit + end-to-end tests (needs Postgres; DB `lifesphere_test` by default, or `TEST_DATABASE_URL`) |
| `npm run typecheck` | Strict TypeScript check including tests |

## Modules

| Area | Endpoints | Highlights |
|---|---|---|
| Auth | `/auth/*` | Phone/email OTP, rotating refresh tokens, per-device sessions, TOTP + recovery codes, step-up re-auth for sensitive actions |
| Me | `/me/*`, `/localities`, `/users/:id/card` | Profile, senior mode, accessibility, quiet hours, lock-screen detail, dashboard widgets, own activity log |
| Privacy | `/privacy/*` | Purpose-specific consents with immediate withdrawal effects, data export, account deletion with 7-day grace, data inventory |
| LifeOS | `/tasks`, `/task-categories`, `/reminders`, `/calendar/events` | Recurring tasks (RRULE), assignments, reminders via the queue, shared calendars and visits |
| Household | `/households`, `/lists`, `/inventory`, `/budgets` | Members and roles, chores, shared grocery lists, announcements, inventory with maintenance schedules, optional manual budget |
| FamilyCare | `/contacts`, `/grants`, `/check-ins`, `/help` | Contact invitations bound to the invited phone, 7 granular revocable scopes with cooling-off, check-in escalation, one-tap help with idempotency |
| Consumer | `/consumer/*` | Purchases and warranties, case workflow, AI draft requiring approval, evidence checklist, official channels |
| Community | `/community/*`, `/civic-issues` | Public/private/invite-only groups, posts, comments, reactions, bookmarks, blocking, reports, appeals, civic issue records |
| Services | `/services/*`, `/service-requests`, `/provider-portal/*` | Directory with verification labels and sponsored disclosure, request lifecycle with history, open-request claiming, reviews |
| Assistant | `/knowledge/*`, `/assistant/*` | Public-knowledge RAG with citations, prompt-injection fencing, optional pgvector, feedback and evaluation runs |
| Admin | `/admin/*` | Staff roles (MFA required), user status, privacy request handling, moderation queue, provider review and verification, catalogue, config, audit log |
| Notifications | `/notifications/*` | Inbox, per-category channel preferences, device registration (FCM / Web Push), provider delivery webhooks |

Full list: [docs/API_ENDPOINTS.md](docs/API_ENDPOINTS.md).

## Rules the code enforces

- **No implied access.** Seeing another person's data requires an explicit `access_grant` (scope, cooling-off, expiry, revocable by either side). Household membership covers household items only. A missing resource and one you may not see both return `404`.
- **Staff cannot read private content.** There is no admin route for tasks, lists, check-ins, cases, calendars or assistant conversations; a test asserts this. Staff actions are audited; staff must use two-factor; moderators cannot decide appeals on their own decisions.
- **Honest delivery status.** Alerts show `queued` / `sent` / `simulated` / `failed`; only a provider webhook can set `delivered`.
- **Nothing is submitted on the user's behalf.** Consumer and civic cases record the user's own submission and the reference they were given.
- **Senior-support providers must be background-screened**; verification levels are derived from recorded checks, never self-declared; ID numbers are rejected from verification notes.
- **Not collected:** bank/card details, statements, tax/salary documents, insurance documents, medical records, ID numbers, date of birth, home address, background location.
- **Logs** never contain bodies, tokens or query strings. **Errors** are RFC 9457 `application/problem+json` with a stable `code`.

## Deploy (Render + Neon)

`render.yaml` in this repository defines `lifesphere-api` (web) and `lifesphere-worker` (background worker), both in Singapore. Set the `lifesphere-secrets` group: Neon pooled URL as `DATABASE_URL`, direct URL as `DATABASE_DIRECT_URL`, `DATABASE_SSL=true`, a 32-byte base64 `ENCRYPTION_KEY`, `APP_BASE_URL`, `CORS_ORIGINS`. Migrations run as the pre-deploy step. Production refuses to start with dev shortcuts (`OTP_DEV_ECHO`, fixed OTP, default webhook secret, disabled throttling, combined process role).

Before real users: SMS DLT templates and MSG91 keys, Resend (paid Render plan for outbound mail), VAPID keys for web push, R2 bucket for attachments, `WORKER_HEARTBEAT_URL` monitor, privacy notice and grievance officer in `app_config.privacy_notice`, legal review, penetration test.

## Known limitations

- Integrations run in simulated mode until credentials are added; each is labelled in `/v1/health/ready`.
- Vector search activates only where the `pgvector` extension exists (Neon has it) and an embeddings key is set; otherwise full-text search is used.
- Payments are deliberately absent (plans and entitlements exist; no money moves).
- Moderation spam detection is heuristic; humans decide high-impact actions.
