# Plan 008: Integration tests for the BFF routes (users, teams, sync, activity)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 635fc3c..HEAD -- packages/bff/src/routes/`
> Route files may legitimately have changed if plans 003/004/006 landed first
> (they touch `sync.ts`, `activity.ts`, and middleware). Read the live route
> files before writing tests — test the code as it exists, not the excerpts
> here. Treat only *structural* surprises (missing routes, renamed services)
> as STOP conditions.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW (tests only)
- **Depends on**: plans/001-typecheck-and-ci.md; execute after 003 and 004 if possible (their behavior is part of what gets locked in)
- **Category**: tests
- **Planned at**: commit `635fc3c`, 2026-06-11

## Why this matters

Every dashboard action flows through five Hono route files totaling ~700 lines — request parsing, validation, GitHub/Google service calls, audit-log writes, job dedupe — and none of it is tested. The existing tests cover two services and the worker's sync engine only. Route tests lock in status codes, response shapes (which the web client parses), and audit-log side effects, and they're the prerequisite safety net for plan 011's service consolidation.

## Current state

- Route files (all in `packages/bff/src/routes/`):
  - `users.ts` — GET `/` (list with status computation), GET `/:email`, GET `/:email/teams`, GET `/:email/repos`, PATCH `/:email/github-username` (validates `typeof body.githubUsername !== 'string'` → 400; 404 on unknown user; writes an `update_github_username` audit row; calls `updateUserCustomSchema`).
  - `teams.ts` — CRUD + members; each mutation awaits a `db.insert(auditLog)` with actions like `create_team`, `add_team_member`.
  - `repos.ts` — repo settings + team access + collaborators; same audit pattern.
  - `sync.ts` — POST `/github` (dedupe via `sync_jobs` select → 409 with `{ message: 'Sync already in progress' }`, else insert + notify → 202 `{ id, status }`), GET `/jobs/:id` (404 via `HTTPException` or the job row).
  - `activity.ts` — GET `/` with `page`/`limit`/`type` params (plan 004 adds `mergeActivityPage`).
- Routes use **module-level singletons** constructed at import time, e.g. `users.ts:18-21`:

```ts
const auth = createGoogleAuth();
const membership = new GitHubMembershipService();
const teamsService = new GitHubTeamsService();
const reposService = new GitHubReposService();
```

  and import `db` from `../db`. Therefore tests MUST `mock.module` the service modules, `../db`, and `../lib/config` **before** `await import('./users')` — the established pattern is `packages/bff/src/services/github-teams.test.ts` (mock first, dynamic-import after; `mock()` fns reset in `beforeEach`).
- Hono apps are testable without a server: `await userRoutes.request('/path', { method, body })` returns a `Response`. Mount-time prefixes (`/api/users`) live in `index.ts`; the route objects themselves serve from `/`.
- The web client's expected response shapes are in `packages/web/src/lib/types.ts` and `packages/web/src/lib/api-client.ts` — assertions should match those shapes.
- Error handling: routes throw `HTTPException`; when testing a route object directly without `onError`, Hono converts `HTTPException` to its response automatically. If a test sees a 500 where 404 is expected, attach the real `errorHandler` (`packages/bff/src/middleware/error-handler.ts`) to a wrapper app.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `bun run typecheck` | exit 0 |
| New tests | `bun test packages/bff/src/routes/` | all pass |
| Full suite | `bun test --recursive` | all pass |
| Lint | `bun run lint` | exit 0 |

## Scope

**In scope** (create only; modify nothing in `src/` runtime code):
- `packages/bff/src/routes/users.test.ts`
- `packages/bff/src/routes/teams.test.ts`
- `packages/bff/src/routes/sync.test.ts`
- `packages/bff/src/routes/activity.test.ts` (extend the file if plan 004 already created it)

**Out of scope** (do NOT touch):
- Any runtime source file. If a test exposes a bug, write the test to **document current behavior** with a `documents current behavior:` name and report it — fixing is a separate decision.
- `repos.ts` tests — same patterns as teams; deliberately deferred to keep this plan a day-ish (note it in the report).
- Spinning up Postgres or hitting real APIs — everything is mocked.

## Git workflow

- Branch: `advisor/008-bff-route-tests`
- Commit per route file; message style: imperative summary, e.g. `Add route tests for users endpoints`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Shared mocking approach (apply per test file)

Each test file starts with (adjust mocks per route's imports — read the route's import list first):

```ts
import { describe, expect, test, mock, beforeEach } from 'bun:test';

mock.module('../lib/config', () => ({
  envVars: { GITHUB_TOKEN: 't', GITHUB_ORG_NAME: 'test-org', /* + API_AUTH_TOKEN etc. if config requires them after plan 006 */ },
}));

const mockInsert = mock(() => ({ values: mockInsertValues }));
const mockInsertValues = mock(async () => [{ id: 'job-1', status: 'pending' }]);
// ...build a chainable fake matching ONLY the db calls the route makes —
// read the route first, then shape the fake (e.g. db.select().from().where().limit()).
mock.module('../db', () => ({ db: fakeDb }));

mock.module('../services/google-workspace', () => ({
  createGoogleAuth: () => ({}),
  getWorkspaceUser: mockGetWorkspaceUser,
  getWorkspaceUsers: mockGetWorkspaceUsers,
  updateUserCustomSchema: mockUpdateUserCustomSchema,
}));
mock.module('../services/github-membership', () => ({
  GitHubMembershipService: class { getMemberUsernames = mockGetMembers; getInvitedUsernames = mockGetInvited; },
}));
// similar for github-teams / github-repos as each route needs

const { userRoutes } = await import('./users');
```

Drizzle chain mocking is the fiddly part. Keep it minimal and per-test-file: implement exactly the chains the route uses (find them with `grep -n "db\." packages/bff/src/routes/<file>.ts`) and have terminal methods resolve arrays. A reusable `makeFakeDb()` helper *within each test file* is fine; don't build a shared fixture module (premature abstraction).

### Step 2: `users.test.ts`

1. GET `/` → 200; users mapped with computed `status`: a workspace user whose normalized GitHub username is in members → `member`; in invites → `pending_invite`; absent → `linked_not_in_org`; no username → `not_linked` (drive all four through one response).
2. GET `/:email` for unknown user (`getWorkspaceUser` → null) → 404.
3. PATCH `/:email/github-username` with `{ githubUsername: 123 }` → 400.
4. PATCH happy path → 200 `{ success: true }`; `mockUpdateUserCustomSchema` called with `(email, username)`; audit insert received `action: 'update_github_username'` and payload containing `previousUsername`/`newUsername`.
5. PATCH for unknown user → 404 and `updateUserCustomSchema` NOT called.

**Verify**: `bun test packages/bff/src/routes/users.test.ts` → 5 pass.

### Step 3: `sync.test.ts`

1. POST `/github` with an existing pending job (fake select resolves `[{ id: 'x', status: 'pending' }]`) → 409, body contains `message: 'Sync already in progress'`.
2. POST `/github` with no existing job → 202, `{ id, status }`; insert called with `type: 'github_sync', triggeredBy: 'dashboard'`; the notify statement executed (assert `db.execute` mock called).
3. GET `/jobs/:id` found → 200 with the job row; not found → 404.
4. (Only if plan 003 landed) the stale-`running` cleanup update runs before the dedupe check — assert the update mock was called.

**Verify**: `bun test packages/bff/src/routes/sync.test.ts` → all pass.

### Step 4: `teams.test.ts`

1. POST `/` (create) happy path → 201 or 200 (match actual code), service called with name/privacy, audit row `create_team` written.
2. POST `/` with missing `name` → assert actual behavior (likely 400 if validated, otherwise document).
3. DELETE `/:slug` → success body; audit `delete_team`.
4. POST `/:slug/members` → service `addTeamMember` called with username/role; audit `add_team_member`.
5. One service-failure case: `GitHubTeamsService` method rejects → response is 500 via error handler (attach `errorHandler` to a wrapper app for this one).

**Verify**: `bun test packages/bff/src/routes/teams.test.ts` → all pass.

### Step 5: `activity.test.ts` (route-level, complements plan 004's pure-helper tests)

1. GET `/?type=sync` → 200, items shaped `{ id: 'sync-...', type: 'sync', summary, details }`, `totalCount` from the count query.
2. GET `/` (merged) → items sorted by timestamp descending across both sources.
3. `limit` clamped: `?limit=999` → at most 100 used (assert via the fake db receiving limit 100, or response `limit: 100`).

**Verify**: `bun test packages/bff/src/routes/activity.test.ts` → all pass.

## Test plan

This plan is the test plan: ~17 new route tests modeled on `github-teams.test.ts`. Gate: `bun test --recursive` all green and `bun run typecheck` exit 0.

## Done criteria

- [ ] Four test files exist covering the cases in Steps 2–5 (≥15 tests)
- [ ] `git diff --stat` shows zero changes to non-test files
- [ ] `bun run typecheck` exits 0; `bun test --recursive` exits 0; `bun run lint` exits 0
- [ ] Any `documents current behavior:` findings listed in your report
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `mock.module('../db', ...)` fails to intercept because of import-order issues after two attempts — report the exact failure; do not refactor routes to inject dependencies (that's a design change someone must approve).
- A route file's structure differs materially from the description (renamed services, moved files) — re-read, and stop if reconciliation requires guessing.
- You're tempted to "quickly fix" a bug a test exposes — out of scope, report it.

## Maintenance notes

- Plan 011 (service consolidation) relies on these tests passing unchanged before and after the refactor.
- `repos.test.ts` was deliberately deferred — mirror `teams.test.ts` when someone picks it up.
- If routes later move to dependency injection (constructor-passed services), these tests get simpler — drop the `mock.module` scaffolding then, keep the assertions.
