# Plan 009: Centralize job types, statuses, and API types in the shared package

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 635fc3c..HEAD -- packages/shared/src/ packages/bff/src/routes/sync.ts packages/worker/src/index.ts packages/worker/src/services/sync-job-repo.ts packages/worker/src/services/job-processor.ts packages/web/src/lib/types.ts`
> Plans 003/008 may have touched some of these files legitimately. Work from
> the live code; treat structural mismatches (missing files/symbols) as STOP.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (string-for-constant substitution; behavior-identical)
- **Depends on**: plans/001-typecheck-and-ci.md; execute AFTER plan 003 if both are queued (003 edits the same lines in sync.ts/sync-job-repo.ts)
- **Category**: tech-debt
- **Planned at**: commit `635fc3c`, 2026-06-11

## Why this matters

The strings that wire the BFF and worker together — job type `'github_sync'`, statuses `'pending' | 'running' | 'completed' | 'failed'` — are typed by hand at every site across three packages. A typo in any one of them doesn't fail anywhere visible: the BFF would happily enqueue a job the worker never claims. The same applies to API-shape types: `UserStatus` is defined identically in `packages/bff/src/routes/users.ts:23` and `packages/web/src/lib/types.ts:1`, and they can drift apart silently. The shared package exists exactly for this (it currently exports a single constant) — this is the established convention for this repo: cross-package strings live in `packages/shared`.

## Current state

- `packages/shared/src/constants.ts` — entire file today: `export const SYNC_JOBS_CHANNEL = 'sync_jobs_channel';`
- `packages/shared/src/index.ts` — barrel export (read it; it re-exports constants and utils).
- `packages/shared/package.json` — check its `exports` map to see which subpaths exist (`@google-github-sync/shared`, `/utils`, `/db`, `/db/schema` are used by imports across the repo).
- Literal sites (find them all with the greps below; known ones at planning time):
  - `packages/bff/src/routes/sync.ts:18,19,34` — `'github_sync'`, `IN ('pending', 'running')`, insert `type: 'github_sync'`.
  - `packages/worker/src/index.ts:31,36` — `hasPendingOrRunning('github_sync')`, `createJob('github_sync', 'cron')`.
  - `packages/worker/src/services/job-processor.ts:20` — `if (job.type === 'github_sync')`.
  - `packages/worker/src/services/sync-job-repo.ts:45,58,81,110,131,143` — status strings in queries/updates.
  - `packages/web/src/lib/types.ts:1` — `UserStatus` duplicate; also `SyncJobStatus` union (web-only today).
  - `packages/bff/src/routes/users.ts:23` — `UserStatus` original.
- The web package imports from `@google-github-sync/shared`? Check `packages/web/package.json` — if `@google-github-sync/shared` is NOT a dependency of web, add it as `"workspace:*"` (it's a types/constants-only import; Next.js transpiles workspace TS deps via `transpilePackages` — check `packages/web/next.config.ts` and add `transpilePackages: ['@google-github-sync/shared']` if importing fails at build).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Find job-type literals | `grep -rn "'github_sync'" packages/*/src` | the list to replace |
| Find status literals | `grep -rEn "'(pending|running|completed|failed)'" packages/*/src` | the list to assess |
| Typecheck | `bun run typecheck` | exit 0 |
| Full suite | `bun test --recursive` | all pass |
| Lint | `bun run lint` | exit 0 |
| Web build check | `cd packages/web && bun run build` | exit 0 |

## Scope

**In scope**:
- `packages/shared/src/constants.ts`, `packages/shared/src/types.ts` (create), `packages/shared/src/index.ts`, `packages/shared/package.json` (exports map if needed)
- Literal replacement in: `packages/bff/src/routes/sync.ts`, `packages/bff/src/routes/users.ts`, `packages/worker/src/index.ts`, `packages/worker/src/services/job-processor.ts`, `packages/worker/src/services/sync-job-repo.ts`, `packages/web/src/lib/types.ts`
- `packages/web/package.json` / `packages/web/next.config.ts` (only if needed to import shared from web)

**Out of scope** (do NOT touch):
- `packages/shared/src/db/schema.ts` — the `default('pending')` column default may stay a literal (changing schema defaults churns migrations for zero gain). Same for test files' literals.
- Renaming any runtime value — `'github_sync'` stays `'github_sync'`; this plan only changes who owns the string.
- UI components that switch on status strings — they keep working because values are unchanged; only update `types.ts` imports.

## Git workflow

- Branch: `advisor/009-shared-constants-and-types`
- Commit style: imperative summary, e.g. `Centralize sync job constants and API types in shared package`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Define constants and types in shared

Append to `packages/shared/src/constants.ts`:

```ts
export const SYNC_JOB_TYPES = {
  GITHUB_SYNC: 'github_sync',
} as const;
export type SyncJobType = (typeof SYNC_JOB_TYPES)[keyof typeof SYNC_JOB_TYPES];

export const SYNC_JOB_STATUSES = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
} as const;
export type SyncJobStatus = (typeof SYNC_JOB_STATUSES)[keyof typeof SYNC_JOB_STATUSES];
```

Create `packages/shared/src/types.ts`:

```ts
export type UserStatus = 'member' | 'pending_invite' | 'not_linked' | 'linked_not_in_org';
```

Export both from `packages/shared/src/index.ts` (match its existing re-export style). If the package.json `exports` map is subpath-based, ensure the root subpath covers the new file or add a `./types` subpath consistent with the existing pattern.

**Verify**: `cd packages/shared && bunx tsc --noEmit` → exit 0.

### Step 2: Replace literals in bff and worker

Using the grep lists, replace each `'github_sync'` with `SYNC_JOB_TYPES.GITHUB_SYNC` and each status literal in TypeScript expressions with `SYNC_JOB_STATUSES.X` (imports from `@google-github-sync/shared`). For raw-SQL fragments like ``sql`${syncJobs.status} IN ('pending', 'running')` `` use interpolation of the constants: ``sql`${syncJobs.status} IN (${SYNC_JOB_STATUSES.PENDING}, ${SYNC_JOB_STATUSES.RUNNING})` `` (bound parameters — valid in a WHERE clause). In `users.ts`, replace the local `type UserStatus = ...` with an import from shared (keep the type name).

**Verify**: `grep -rn "'github_sync'" packages/bff/src packages/worker/src --include='*.ts' | grep -v test` → no matches. `bun run typecheck` → exit 0. `bun test --recursive` → all pass.

### Step 3: Point the web package at shared types

In `packages/web/src/lib/types.ts`, replace the local `UserStatus` and `SyncJobStatus` definitions with re-exports:

```ts
export type { UserStatus, SyncJobStatus } from '@google-github-sync/shared';
```

(keep every other type in the file as-is). Add the workspace dependency / `transpilePackages` only if the import fails (see Current state).

**Verify**: `cd packages/web && bunx tsc --noEmit` → exit 0; `cd packages/web && bun run build` → exit 0.

## Test plan

No new tests — this is a behavior-identical substitution guarded by the existing suite and typecheck. The constants get exercised by sync-engine/route tests from plans 003/008.

## Done criteria

- [ ] `grep -rn "'github_sync'" packages/bff/src packages/worker/src --include='*.ts' | grep -v test | grep -v shared` → no matches
- [ ] `UserStatus` defined exactly once (`grep -rn "type UserStatus" packages/*/src` → only `packages/shared/src/types.ts`)
- [ ] `bun run typecheck` exits 0; `bun test --recursive` exits 0; `bun run lint` exits 0; web `bun run build` exits 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The web build fails on the shared import after adding `transpilePackages` — report the error; do not copy the types back.
- Drizzle raw-SQL interpolation of the constants produces a runtime/type error you can't fix in one attempt (fallback: keep that one literal and note it).
- The shared package's `exports` map doesn't allow a clean export without restructuring — report rather than reshaping the package.

## Maintenance notes

- New job types (e.g. an `atlassian_sync` job) get added to `SYNC_JOB_TYPES` first, then used — never as inline strings. Worth a line in CLAUDE.md.
- The schema default `'pending'` was intentionally left literal; if statuses are ever renamed, update schema + constants together with a migration.
- Reviewer: this diff should contain zero logic changes — any conditional or query whose shape changed is a red flag.
