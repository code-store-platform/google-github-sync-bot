# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Google-GitHub Sync is an open-source tool that synchronizes Google Workspace users with GitHub organization members. It automatically invites users with GitHub usernames to a GitHub organization and removes users who are no longer in Google Workspace. Atlassian integration is available behind a feature flag (`ATLASSIAN_ENABLED`). Slack is used for notifications only (not as a bot). The tool provides scheduled synchronization via cron jobs and an admin dashboard for visual management.

## Monorepo Structure

```
/
├── packages/
│   ├── shared/          # Shared DB schema, types, utils
│   │   └── src/
│   │       ├── db/schema.ts       # Drizzle ORM schema (audit_log, sync_history, sync_jobs)
│   │       ├── db/index.ts        # DB client factory (createDb)
│   │       ├── utils.ts           # normalizeGitHubUsername, normalizeEmail
│   │       └── index.ts           # Barrel export
│   ├── bff/             # Hono API for the dashboard (Process 1)
│   │   └── src/
│   │       ├── index.ts           # Hono server entry
│   │       ├── lib/config.ts      # BFF-specific config (Zod validation)
│   │       ├── db/index.ts        # DB client instance
│   │       ├── middleware/         # CORS, error handler
│   │       ├── routes/            # API routes (users, teams, repos, sync)
│   │       └── services/          # Google Workspace, GitHub teams/repos/membership
│   ├── worker/          # Effect.ts sync engine (Process 2)
│   │   └── src/
│   │       ├── index.ts           # Worker entry (job processor + cron)
│   │       ├── lib/config.ts      # Worker-specific config (Zod validation)
│   │       └── services/          # Effect services (Google, GitHub, Slack, sync engine)
│   │           └── atlassian/     # Feature-flagged Atlassian integration
│   └── web/             # Next.js dashboard (Process 3)
│       └── src/
│           ├── app/               # Next.js App Router pages
│           ├── components/        # React components (layout, users, teams, repos, ui)
│           ├── hooks/             # Custom hooks (use-toast)
│           └── lib/               # API client, types, utils
├── docs/                # Architecture documentation
├── package.json         # Bun workspace root
├── biome.json           # Shared linter/formatter
├── tsconfig.base.json   # Shared TS config
└── docker-compose.yml   # PostgreSQL
```

## Development Commands

**Install dependencies:**
```bash
bun install
```

**Start all services:**
```bash
bun run dev
```

**Start individually:**
```bash
bun run dev:bff      # Hono API on port 4000
bun run dev:worker   # Sync worker
bun run dev:web      # Next.js on port 3001
```

**Database:**
```bash
docker compose up -d          # Start PostgreSQL
bun run db:push               # Push schema to DB
bun run db:studio             # Open Drizzle Studio
```

**Format code:**
```bash
bun run format
```

**Lint code:**
```bash
bun run lint
```

**Run tests:**
```bash
bun test --recursive
```

**IMPORTANT: Always run `bun test --recursive` after making code changes to ensure nothing is broken. Do not skip this step.**

## Architecture

### BFF/Worker Split

The system is split into two backend processes sharing the same PostgreSQL database:

- **BFF** (`packages/bff`): Stateless Hono API serving the dashboard. Handles user CRUD, team/repo management (direct GitHub API calls), audit logging, and enqueuing sync jobs.
- **Worker** (`packages/worker`): Effect.ts-based sync engine. Picks up jobs from `sync_jobs` table via Postgres LISTEN/NOTIFY + polling fallback. Runs cron-scheduled syncs. Sends Slack notifications.

Communication: BFF writes to `sync_jobs` table, worker picks up and processes jobs. No direct HTTP calls between them.

**Cron Jobs:**
- GitHub sync (configurable schedule via `CRON_SCHEDULE`)
- Atlassian inactivity check (feature-flagged, `ATLASSIAN_INACTIVITY_CRON_SCHEDULE`)

### Database (PostgreSQL via Drizzle ORM)

Schema lives in `packages/shared/src/db/schema.ts`:
- `audit_log` — Tracks admin actions from BFF (username changes, team/repo ops)
- `sync_history` — Permanent log of completed sync executions
- `sync_jobs` — Transient job queue (BFF writes, worker consumes)

### Web Dashboard (packages/web)

**Next.js 15** with App Router on port 3001:
- User directory with search, filter, sort
- User profile with GitHub username editing
- Teams management (CRUD + members)
- Repos management (settings + team access)
- Async sync: triggers job, polls for status

**Tech Stack:**
- TanStack Query for data fetching
- shadcn/ui + Tailwind CSS v4 for styling
- Radix UI primitives

## Key Technical Details

**Google Workspace Integration:**
- Uses service account credentials with domain-wide delegation
- Requires `admin.directory.user` scope (read + write)
- Impersonates admin user via `subject` field
- Fetches up to 300 users with custom schema projection
- GitHub usernames stored in `customSchemas['3rd-party_tools'].GitHub_Username`

**GitHub Integration:**
- Uses Octokit with personal access token
- Requires organization admin permissions
- Uses pagination for listing members and pending invitations
- Invites users by `invitee_id` (not by email)
- All username comparisons are case-insensitive via `.toLowerCase()`

**Sync Job Flow:**
1. BFF inserts row into `sync_jobs` (status: `pending`)
2. BFF sends `NOTIFY sync_jobs_channel` to Postgres
3. Worker picks up job, sets status to `running`
4. Worker executes sync (Google -> GitHub diff, invite/remove)
5. Worker writes result to `sync_history`, updates `sync_jobs` status
6. Dashboard polls `GET /api/sync/jobs/:id` for status

**Remove Stop List:**
- `REMOVE_STOP_LIST` env var: comma-separated GitHub usernames never removed from org

**Atlassian (feature-flagged):**
- Enabled via `ATLASSIAN_ENABLED=true`
- Suspends users not in Google Workspace
- Checks 3-month / 6-month inactivity (suspend / delete)
- Supports dry-run mode via `ATLASSIAN_DRY_RUN`

## Environment Configuration

Each package validates only its own required env vars. The `.env` file lives at the monorepo root.

**BFF env vars:**
- `GOOGLE_APPLICATION_CREDENTIALS`: JSON string of service account credentials
- `GOOGLE_ADMIN_EMAIL`: Admin email to impersonate
- `GITHUB_TOKEN`: GitHub personal access token with org admin permissions
- `GITHUB_ORG_NAME`: GitHub organization name
- `DATABASE_URL` (default: `postgres://postgres:postgres@localhost:5432/dashboard`)
- `API_PORT` (default: `4000`)
- `CORS_ORIGIN` (default: `http://localhost:3001`)

**Worker env vars:**
- `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_ADMIN_EMAIL`, `GITHUB_TOKEN`, `GITHUB_ORG_NAME`: Same as BFF
- `DATABASE_URL` (default: `postgres://postgres:postgres@localhost:5432/dashboard`)
- `CRON_SCHEDULE` (default: midnight daily)
- `REMOVE_STOP_LIST`: Comma-separated GitHub usernames to never remove
- `SLACK_BOT_TOKEN` (optional): Bot user OAuth token for notifications
- `SLACK_NOTIFICATION_CHANNEL` (optional): Channel ID for notifications
- `ATLASSIAN_ENABLED` (default: `false`)
- `ATLASSIAN_API_KEY`, `ATLASSIAN_ORG_ID`, `ATLASSIAN_ADMIN_EMAIL`: Required when Atlassian enabled
- `ATLASSIAN_DRY_RUN`: Enable dry-run mode
- `ATLASSIAN_INACTIVITY_CRON_SCHEDULE` (default: midnight daily)

## Runtime

- Built for Bun runtime (not Node.js)
- Uses TypeScript with strict mode enabled
- No build step required for BFF/worker (noEmit: true in tsconfig)
- Next.js uses standard build process
- Worker uses Effect.ts for structured concurrency, typed errors, and service layers
- Prefer imports without extensions, DO NOT use .js extensions in import paths
