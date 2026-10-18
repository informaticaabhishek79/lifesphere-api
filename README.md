# LifeSphere — API

Privacy-first personal life management, family care, community and local assistance platform.
This repository is the **backend**: the API and its background worker. The web app lives in its own repository, **lifesphere-web**; the Android app follows.

**Web app:** start this API as below, then follow the README in the lifesphere-web repository (it runs on `http://localhost:3008`).

**Changing the API?** Run `npm run openapi` and commit `openapi.json`; the web repo copies it with `npm run api:pull`.

| | |
|---|---|
| Stack | Node 22, NestJS 11, TypeScript, PostgreSQL 15+ (Drizzle ORM), pg-boss job queue |
| API | 355 operations on 265 paths, versioned under `/v1`, OpenAPI at `/docs` |
| Database | 94 tables (90 `public`, 4 `auth`), 6 migrations, idempotent seed |
| Tests | 176 automated tests in 12 suites, run against a real Postgres |
| Countries | Any country: phone numbers, emergency number, currency, time zone and language per country; official complaint channels and guides tagged by country |
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

**Updating an existing database?** Run `npm run db:migrate` and then `npm run db:seed` again after pulling new code. Both are safe to repeat; the seed only adds or updates its own rows.

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
| Me | `/me/*`, `/localities`, `/countries`, `/users/:id/card` | Profile with country, senior mode, accessibility, quiet hours, lock-screen detail, dashboard widgets, own activity log |
| Privacy | `/privacy/*` | Purpose-specific consents with immediate withdrawal effects, data export, account deletion with 7-day grace, data inventory |
| LifeOS | `/tasks`, `/task-categories`, `/reminders`, `/calendar/events` | Recurring tasks (RRULE), assignments, reminders via the queue, shared calendars and visits |
| Household | `/households`, `/lists`, `/inventory`, `/budgets` | Members and roles, chores, shared grocery lists, announcements, inventory with maintenance schedules, optional manual budget |
| FamilyCare | `/contacts`, `/grants`, `/check-ins`, `/help` | Contact invitations bound to the invited phone, 7 granular revocable scopes with cooling-off, check-in escalation, one-tap help with idempotency |
| Consumer | `/consumer/*` | Purchases and warranties, case workflow, AI draft requiring approval, evidence checklist, official channels |
| Community | `/community/*`, `/civic-issues` | Public/private/invite-only groups, posts, comments, reactions, bookmarks, blocking, reports, appeals, civic issue records |
| Services | `/services/*`, `/service-requests`, `/provider-portal/*` | Directory with verification labels and sponsored disclosure, request lifecycle with history, open-request claiming, reviews |
| Assistant | `/knowledge/*`, `/assistant/*` | Public-knowledge RAG with citations, prompt-injection fencing, optional pgvector, feedback and evaluation runs |
| Admin | `/admin/*` | Staff roles (MFA required), user status, privacy request handling, moderation queue, provider review and verification, catalogue, config, audit log |
| Documents | `/documents/*` | Folders (nested) and files: upload (type checked from content), text notes, rename, move, bin with restore, preview |
| Agents | `/agents/*`, `/mail/*` | Email agents (Gmail, Outlook or a sample mailbox) and documents agents limited to granted folders; activity log; review-before-send |
| Voice assistant | `/voice/*` | Answers questions about your own data and how to use the app; picks the right feature with read-only tools; documents only from chosen folders |
| Notifications | `/notifications/*` | Inbox, per-category channel preferences, device registration (FCM / Web Push), provider delivery webhooks |

Full list: [docs/API_ENDPOINTS.md](docs/API_ENDPOINTS.md).

## Countries and languages

- **Phone numbers** are read with the country the person picks at sign-in (any country; numbers are checked to be real mobile numbers). Without a country, `+91` numbers are assumed for 10-digit input, so existing Indian users are unaffected.
- **A person's country** (`user_profiles.country`) comes from sign-up (picked country → phone number → time zone) and can be changed in settings. It sets the default **emergency number** for the help button, the **budget currency**, the **time zone** suggestion, the official **complaint channels** and the **guides** the assistant uses. Channels and guides with no country apply everywhere.
- `GET /v1/countries` lists every supported country with its dialling code, currency, emergency number, time zone and main language. The table is in `src/common/countries.ts`; check emergency numbers for each market before launch.
- **Localities** are seeded for India plus a starter set in the UK, US, Canada, Australia, UAE, Saudi Arabia, Singapore, Germany, France, Spain and Bangladesh; add more in the staff console (Catalogue).
- **SMS:** `SMS_PROVIDER=msg91` (India), `twilio` (worldwide), or `routed` (`+91` via MSG91, everything else via Twilio). Twilio needs `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM` or `TWILIO_MESSAGING_SERVICE_SID`.
- **WhatsApp instead of SMS:** `SMS_PROVIDER=whatsapp` sends sign-in codes and alerts through the WhatsApp Cloud API (Meta), so no DLT registration is needed. Set `WHATSAPP_TOKEN` (a permanent System User token), `WHATSAPP_PHONE_NUMBER_ID`, and approve two templates in WhatsApp Manager: an **Authentication** template (`WHATSAPP_OTP_TEMPLATE`, default `lifesphere_code`, with a *Copy code* button) and a **Utility** template (`WHATSAPP_ALERT_TEMPLATE`, default `lifesphere_alert`) whose body has one variable, e.g. `LifeSphere: {{1}}`. Template language: `WHATSAPP_TEMPLATE_LANGUAGE` (default `en`).
- **Daily jobs** (digest, retention) run at 08:00 / 02:30 in `JOBS_TIMEZONE` (default `UTC`; set `Asia/Kolkata` to keep the old India timing).
- The assistant and complaint drafts are told the person's country, emergency number and language.

## Parent care

The focused version of LifeSphere for families looking after an elderly parent. It is built on the existing contacts, grants, check-ins and help — no new way to see anyone's data.

- **What the home is for** (`homeMode`): `caregiver` (my home shows how the people I look after are doing), `cared_for` (simple home with big buttons) or `standard`. `POST /v1/care/mode` sets it; with `focus` it also hides features unrelated to care, which come back from Settings or by choosing `standard`.
- **Invitations that ask to share back:** a son can invite his mother with `requestedScopes` (see check-ins, alerts, help alerts, calendar…). She sees exactly what is asked, unticks what she wants, and accepts with `shareBack`. That creates ordinary grants from her, with the same safeguards as Sharing (recent sign-in, cooling-off, SMS notice, audit). Nothing outside what was asked can be shared this way.
- **Medicine reminders** are check-ins with `purpose: 'medicine'`: the same reminder → grace → alert-your-contacts engine, with their own wording. "I'm OK" never ticks a medicine (each one is confirmed with "Taken"), and text messages never name the medicine.
- **One-step setup** for the person being looked after: `POST /v1/care/setup` (daily check-in time, medicines and times, who is alerted, who to call first in Get help, larger text, focus). Running it again moves the daily check-in instead of adding a second one. A parent can set up first and invite her children after: people who accept an invitation offering `checkins.alerts` are added to her alerting check-ins.
- **Views:** `GET /v1/care/people` (caregiver: each person who shares check-ins or help alerts, most urgent first, with today's check-ins and medicines, open help requests, shared appointments, invitations still waiting) and `GET /v1/care/today` (the parent's day, next times, who is looking out for them, call buttons). The voice assistant answers "Did Mum take her medicine?" from the same data.

## Documents and agents

- **Documents** are the person's own folders and files (PDF, images, Word/Excel/PowerPoint, text; 20 MB each by default). Text files are kept as text so an agent can read them; other types can be filed, renamed, moved and binned but not read yet. Deleted items stay in the bin for 30 days. The page asks people not to store ID, bank, tax, insurance or medical papers there.
- **Documents agents** only see the folders they are given, each **read only** or **read and edit** (folders inside are included). The model asks for tools (list, read, create note, rename, move, bin…) and **every call is checked on the server against that grant**; anything else is reported as "not found". File text is passed to the model as data, never as instructions. Removing a grant takes effect on the next request.
- **Email agents** use one mailbox. The person reads their inbox in LifeSphere (fetched live, not stored); the agent receives **only the one email the person points it at**, writes the reply and sends it in the same thread — or holds it for review when "review before sending" is on. Emails asking the agent to do other things are treated as data.
- **Activity log:** every request, each step an agent took (or was blocked from), and every reply it wrote, kept 90 days (`AGENT_RUN_RETENTION_DAYS`). File contents are not copied into the log.
- **Without an AI key** agents run a clearly labelled simulated mode that understands simple English requests ("List my files", "Summarise …", "Rename … to …", "Move … to …", "Create folder …", "Create note Name: text"). With `AI_PROVIDER=anthropic` they understand any request in any language.

### Voice assistant

`POST /v1/voice/ask` answers a spoken or typed question. The web app turns speech into text and reads the answer aloud with the browser's own speech features (Chrome, Edge and Safari; other browsers can type).

- **The brain:** with `AI_PROVIDER=anthropic` the model chooses which parts of the app to look in, using 18 **read-only** tools (tasks, reminders, calendar, households, shopping lists, home inventory, budget, check-ins, contacts and sharing, emergency help, consumer cases and warranties, service requests, community, civic issues, document search and reading, guides, and an app how-to). It can call several for one question ("my day" = tasks + calendar), then answers in 1–4 short sentences in the person's language, with links to the screens it used.
- **Same rules as the app:** each tool calls the same service the screens use, so household and sharing rules apply unchanged. Tools for features switched off in Settings are not offered. Documents only from the folders chosen under "What it can read" (`/v1/voice/settings`). It never changes anything.
- **Nothing stored:** the conversation lives in the browser tab (the last few turns are sent with each question). The activity log records only which areas were looked up.
- **Without an AI key** a keyword router (English and some Hindi) picks the feature and reads back real data, labelled "Simulated".

### Connecting Gmail and Outlook

Until these are set, only the sample mailbox (`MAIL_DEMO_ENABLED`, on outside production) is offered.

- **Sign in with Google:** Google Cloud console → APIs & Services → OAuth consent screen (scopes `openid`, `email`, `profile` only — these need no Google verification) → Credentials → *OAuth client ID*, type *Web application*, authorised redirect URI `<APP_BASE_URL>/auth/google/callback` (for example `http://localhost:3008/auth/google/callback`). Put the ID and secret in `GOOGLE_SIGNIN_CLIENT_ID` / `GOOGLE_SIGNIN_CLIENT_SECRET`; the sign-in page shows the button once `/v1/health/ready` reports `googleSignIn: on`. A Google account links to an existing LifeSphere account with the same verified email.
- **Gmail:** Google Cloud console → APIs & Services → enable the *Gmail API* → OAuth consent screen (add scopes `gmail.readonly` and `gmail.send`; while in testing, add your Google account as a test user) → Credentials → *OAuth client ID*, type *Web application*, redirect URI `<API_BASE_URL>/v1/mail/oauth/gmail/callback` (for example `http://localhost:4008/v1/mail/oauth/gmail/callback`). Put the client ID and secret in `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. Public launch needs Google's verification for these scopes.
- **Outlook:** Microsoft Entra admin center → App registrations → New, "Accounts in any organizational directory and personal Microsoft accounts", redirect URI (Web) `<API_BASE_URL>/v1/mail/oauth/outlook/callback`. Add delegated Graph permissions `Mail.Read`, `Mail.Send`, `User.Read`, `offline_access`; create a client secret. Set `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` (and `MICROSOFT_TENANT`, default `common`).
- `API_BASE_URL` must be the address the browser can reach the API on, and `APP_BASE_URL` the web app's address (the callback sends people back to `/email`).

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

Before real users: SMS keys (MSG91 with DLT templates for India, Twilio elsewhere), Resend (paid Render plan for outbound mail), VAPID keys for web push, R2 bucket for attachments, `WORKER_HEARTBEAT_URL` monitor, privacy notice and grievance officer in `app_config.privacy_notice`, legal review for each market you open (India DPDP, EU/UK GDPR, US state laws…), native-speaker review of translations, penetration test.

## Known limitations

- Integrations run in simulated mode until credentials are added; each is labelled in `/v1/health/ready`.
- Vector search activates only where the `pgvector` extension exists (Neon has it) and an embeddings key is set; otherwise full-text search is used.
- Payments are deliberately absent (plans and entitlements exist; no money moves).
- Moderation spam detection is heuristic; humans decide high-impact actions.
