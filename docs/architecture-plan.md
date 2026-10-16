# Architecture Plan: BFF/Worker Split + Effect.ts

## Goals

1. Productify the Google <> GitHub sync as an open-source self-hostable tool (path to multi-tenant SaaS)
2. Split the monolith into BFF (dashboard API) and Worker (sync engine)
3. Feature-flag Atlassian behind an env var
4. Introduce Effect.ts in the Worker
5. Replace Slack bot with lightweight notification-only client

---

## Target Package Structure

```
packages/
  shared/        Drizzle schema, TS types, utility functions
  bff/           Hono API serving the dashboard
  worker/        Effect.ts sync engine, cron, Slack notifications
  web/           Next.js dashboard (minimal changes)
```

### `packages/shared`

Owns:
- Drizzle ORM schema (`audit_log`, `sync_history`, `sync_jobs`)
- Drizzle DB client factory
- Shared TypeScript types (`User`, `SyncJob`, `SyncResult`, etc.)
- Utility functions (`normalizeGitHubUsername`, `normalizeEmail`)

Does NOT own:
- Configuration / env var validation (each package validates its own)

### `packages/bff`

Hono API on port 4000. Serves the Next.js dashboard.

Routes:
- `GET /api/users` — list workspace users with GitHub membership status
- `GET /api/users/:email` — single user detail
- `PATCH /api/users/:email/github-username` — update GitHub username in Google Workspace
- `GET /api/teams` — list GitHub teams
- `POST /api/teams` — create team
- `GET /api/teams/:slug` — team detail
- `PATCH /api/teams/:slug` — update team
- `DELETE /api/teams/:slug` — delete team
- `POST /api/teams/:slug/members` — add member
- `DELETE /api/teams/:slug/members/:username` — remove member
- `GET /api/repos` — list repos
- `GET /api/repos/:name` — repo detail
- `PATCH /api/repos/:name` — update repo
- `POST /api/repos/:name/teams` — add team access
- `DELETE /api/repos/:name/teams/:slug` — remove team access
- `POST /api/sync/github` — enqueue a sync job (writes to `sync_jobs` table)
- `GET /api/sync/jobs/:id` — poll job status
- `GET /api/sync/history` — query completed sync history

External API calls:
- Google Workspace (read users, update custom schema)
- GitHub (teams/repos CRUD) — direct calls, not queued

Writes to:
- `audit_log` — human-initiated actions
- `sync_jobs` — enqueue sync requests

Env vars (validated per-package):
- `DATABASE_URL`
- `API_PORT`
- `CORS_ORIGIN`
- `GOOGLE_APPLICATION_CREDENTIALS`
- `GOOGLE_ADMIN_EMAIL`
- `GITHUB_TOKEN`
- `GITHUB_ORG_NAME`

### `packages/worker`

Effect.ts-based sync engine. Runs as a separate process.

Responsibilities:
- Pick up `sync_jobs` rows via five-second polling with atomic claims
- Execute Google <> GitHub sync (diff workspace users against org members, invite/remove)
- Run cron-scheduled syncs (creates its own `sync_jobs` rows)
- Send Slack notifications on sync completion
- Feature-flagged: Atlassian suspension/inactivity sync

Writes to:
- `sync_jobs` — update status (`pending` -> `running` -> delete on completion)
- `sync_history` — append completed sync results

Env vars (validated per-package):
- `DATABASE_URL`
- `GOOGLE_APPLICATION_CREDENTIALS`
- `GOOGLE_ADMIN_EMAIL`
- `GITHUB_TOKEN`
- `GITHUB_ORG_NAME`
- `SLACK_BOT_TOKEN` (optional — notifications disabled if absent)
- `CRON_SCHEDULE`
- `REMOVE_STOP_LIST`
- `ATLASSIAN_ENABLED` (default: false)
- `ATLASSIAN_API_KEY` (required if Atlassian enabled)
- `ATLASSIAN_ORG_ID` (required if Atlassian enabled)
- `ATLASSIAN_ADMIN_EMAIL` (required if Atlassian enabled)
- `ATLASSIAN_DRY_RUN` (optional)

### `packages/web`

Next.js 15 dashboard. Minimal changes from current state.

Only change: sync page becomes async-aware.
- "Sync Now" button -> POST to BFF -> receives job ID
- Poll `GET /api/sync/jobs/:id` via TanStack Query `refetchInterval`
- Show pending/running/completed/failed states

---

## Database Schema Changes

### New table: `sync_jobs`

Transient job queue. Worker picks up pending rows and deletes them on completion.

```sql
CREATE TABLE sync_jobs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type        TEXT NOT NULL,          -- 'github_sync', 'atlassian_sync', etc.
  status      TEXT NOT NULL DEFAULT 'pending',  -- 'pending', 'running', 'completed', 'failed'
  triggered_by TEXT NOT NULL,         -- 'dashboard', 'cron'
  created_at  TIMESTAMP NOT NULL DEFAULT now(),
  started_at  TIMESTAMP,
  completed_at TIMESTAMP,
  result      JSONB
);

CREATE INDEX idx_sync_jobs_pending ON sync_jobs (type, status) WHERE status = 'pending';
```

Lifecycle:
1. BFF or cron inserts row with `status = 'pending'`
2. Worker polls for pending jobs every five seconds
3. Worker picks it up, sets `status = 'running'`, `started_at = now()`
4. Worker executes sync
5. Worker writes result to `sync_history`
6. Worker deletes the `sync_jobs` row (or marks `completed`/`failed` briefly for polling, then cleans up)

Constraint: only one `running` or `pending` job per `type` at a time.

### Existing table: `sync_history` (unchanged)

Append-only log of completed syncs. Worker writes here after finishing a job.

### Existing table: `audit_log` (unchanged)

BFF writes here for human-initiated actions (username changes, team/repo management).

---

## Effect.ts in the Worker

### Where Effect applies

| Concern | Effect feature |
|---|---|
| Job pickup (atomic claim + poll) | `Schedule.spaced` poll with `FOR UPDATE SKIP LOCKED` |
| Sync orchestration | `Effect.gen` pipelines with typed errors |
| Google/GitHub API calls | Effect services with `Context.Tag` |
| Retry logic | `Effect.retry` with `Schedule.exponential` |
| Rate limiting | `Effect.schedule` / semaphores |
| Partial failures (8 invites, 2 fail) | `Effect.forEach` with `{ concurrency: N }` collecting errors |
| Slack notifications | Effect service, fire-and-forget with error logging |
| Configuration | `Config` layer from Effect |
| Logging | `Effect.log` structured logging |
| Graceful shutdown | `Effect.addFinalizer` for cleanup |

### Service architecture (Effect layers)

```
GoogleWorkspaceService    -- fetch users, update custom schema
GitHubService             -- list members, invite, remove, pagination
SlackNotificationService  -- send notification messages
SyncJobRepository         -- read/write sync_jobs table
SyncHistoryRepository     -- write sync_history table
SyncEngine                -- orchestrates the sync pipeline
```

Each service is a `Context.Tag` with a live implementation layer. This gives:
- Testability: swap live layers for test layers
- Dependency injection: no global singletons
- Clear error types per service

---

## Slack Changes

- Remove `@slack/bolt` dependency
- Add `@slack/web-api` dependency
- Remove `SLACK_APP_TOKEN` and `SLACK_SIGNING_SECRET` env vars
- Keep `SLACK_BOT_TOKEN` only (optional — worker skips notifications if absent)
- Worker sends notifications via `WebClient.chat.postMessage()`
- Existing Block Kit message formatting in `slack-notifier.ts` can be reused

---

## Atlassian Feature Flag

- Gate on `ATLASSIAN_ENABLED` env var (default: `false`)
- When disabled:
  - Worker skips Atlassian cron jobs
  - Atlassian env vars are not required
  - No Atlassian-related code paths execute
- When enabled:
  - Worker validates `ATLASSIAN_API_KEY`, `ATLASSIAN_ORG_ID`, `ATLASSIAN_ADMIN_EMAIL`
  - Registers Atlassian cron jobs (suspension sync, inactivity checks)
  - Sends Atlassian-specific Slack notifications
- Code stays in `packages/worker/src/services/atlassian/`

---

## Migration Steps

Ordered by dependency. Each step should be a working state.

### Phase 1: Extract shared package

1. Create `packages/shared/`
2. Move Drizzle schema (`db/schema.ts`) and DB client (`db/index.ts`) to shared
3. Move types and utils to shared
4. Update imports in `packages/server/` to use `@google-github-sync/shared`
5. Verify everything still works as a monolith

### Phase 2: Create BFF package

1. Create `packages/bff/`
2. Move Hono app setup, middleware, and routes from `packages/server/`
3. Move `google-workspace.ts` service (needed for user routes)
4. Move `github-teams.ts` and `github-repos.ts` services (direct API calls)
5. Create BFF-specific config validation
6. Wire up `sync_jobs` insertion for `POST /api/sync/github`
7. Add `GET /api/sync/jobs/:id` endpoint
8. Verify dashboard works against new BFF

### Phase 3: Create worker package with Effect.ts

1. Create `packages/worker/`
2. Set up Effect.ts dependencies
3. Implement core services as Effect layers:
   - `SyncJobRepository` (atomic claim + poll)
   - `GoogleWorkspaceService`
   - `GitHubService`
   - `SlackNotificationService` (using `@slack/web-api`)
   - `SyncHistoryRepository`
4. Implement `SyncEngine` that orchestrates the pipeline
5. Implement cron job scheduling
6. Port Atlassian sync behind feature flag
7. Verify end-to-end: dashboard -> BFF -> sync_jobs -> worker -> sync_history

### Phase 4: Dashboard async sync

1. Update sync page to POST and receive job ID
2. Add job status polling with TanStack Query
3. Show pending/running/completed/failed states
4. Remove the old blocking sync flow

### Phase 5: Cleanup

1. Delete `packages/server/`
2. Update root `package.json` workspace config and dev scripts
3. Update `CLAUDE.md` with new architecture
4. Update `docker-compose.yml` if needed (both processes)
5. Update `.env.example` with per-package env var documentation

---

## Dev Scripts (root package.json)

```json
{
  "scripts": {
    "dev:bff": "bun run --filter @google-github-sync/bff dev",
    "dev:worker": "bun run --filter @google-github-sync/worker dev",
    "dev:web": "bun run --filter @google-github-sync/web dev",
    "dev": "bun run dev:bff & bun run dev:worker & bun run dev:web",
    "db:push": "bun run --filter @google-github-sync/shared db:push",
    "db:studio": "bun run --filter @google-github-sync/shared db:studio"
  }
}
```

---

## Decisions Deferred

- **Plugin interface**: wait until a second integration needs it. Atlassian feature-flag is sufficient for now.
- **Multi-tenant schema**: add `tenant_id` columns when moving to SaaS (Phase B).
- **Real-time dashboard**: SSE/WebSocket for live sync status. Polling is fine for now.
- **Integrations settings UI**: no UI for enabling/configuring plugins yet.
- **Auth/RBAC on BFF**: no authentication on the dashboard API yet. Add when exposing publicly.
