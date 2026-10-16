# Plan 003: Make the sync-job pipeline reliable — no stuck `running` jobs, atomic claims, working NOTIFY

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 635fc3c..HEAD -- packages/worker/src/services/sync-engine.ts packages/worker/src/services/sync-job-repo.ts packages/worker/src/services/sync-engine.test.ts packages/bff/src/routes/sync.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (changes job lifecycle semantics; mitigated by existing + new tests)
- **Depends on**: plans/001-typecheck-and-ci.md
- **Category**: bug
- **Planned at**: commit `635fc3c`, 2026-06-11

## Why this matters

Three related defects in the job pipeline:

1. **Stuck jobs**: a sync whose only outcome is errors (0 invited, 0 removed, ≥1 error — e.g. GitHub rejects every invite) satisfies neither the `completeJob` condition nor the failure path, so the job stays `running` forever. The BFF's duplicate-check then returns 409 "Sync already in progress" for every dashboard-triggered sync. The only cleanup is a 10-minute timeout that runs *inside the worker's cron handler* — by default once a day — so the dashboard can be bricked for up to 24h.
2. **Non-atomic claim**: `claimNextJob` is a plain `SELECT`; marking `running` happens later in a separate statement. Today this is safe only because exactly one worker polls sequentially. Any second worker instance (scaling, an accidentally running dev worker against prod DB) double-processes jobs → duplicate invites/removals.
3. **Broken NOTIFY**: the BFF sends `NOTIFY` with a bound parameter. Postgres utility commands cannot take extended-protocol parameters, so this statement likely throws at runtime — *after* the job row was inserted — making `POST /api/sync/github` return 500 while the sync still runs via the worker's 5s poll. (The worker's NOTIFY listener only logs anyway; polling is the real pickup mechanism.)

## Current state

### Files

- `packages/worker/src/services/sync-engine.ts` — `processGitHubSync(jobId)`: marks running, runs the diff, decides complete/fail.
- `packages/worker/src/services/sync-job-repo.ts` — `SyncJobRepo` Effect service: claim/markRunning/complete/fail/create/hasPendingOrRunning against the `sync_jobs` table (Drizzle + Postgres).
- `packages/worker/src/services/sync-engine.test.ts` — existing tests with mock layers; asserts call order `markRunning` → `completeJob` (lines 175–185).
- `packages/bff/src/routes/sync.ts` — POST `/github` (dedupe check + insert + NOTIFY), GET `/jobs/:id`.
- `packages/worker/src/services/job-processor.ts` — calls `claimNextJob()` then `processGitHubSync(job.id)`; **read-only context for this plan, do not modify.**
- Schema (`packages/shared/src/db/schema.ts:30-41`): `sync_jobs(id uuid pk, type text, status text default 'pending', triggered_by, started_at, completed_at, details, created_at, result jsonb)`.

### Defect 1 — sync-engine.ts lines 71–92 (verbatim today):

```ts
const syncResult = yield* runSync.pipe(
  Effect.catchAll((error) => {
    return Effect.gen(function* () {
      yield* jobRepo.failJob(jobId, error.message);
      yield* Effect.logError(`GitHub sync failed: ${error.message}`);
      return { invited: [], removed: [], errors: [error.message] } as SyncResult;
    });
  }),
);

// If the job wasn't already failed by the catch above
if (syncResult.errors.length === 0 || syncResult.invited.length > 0 || syncResult.removed.length > 0) {
  yield* jobRepo.completeJob(jobId, { ... });
}
```

When `runSync` *succeeds* with `invited: []`, `removed: []`, `errors: ['...']` (partial errors are accumulated inside `runSync`, they don't throw), the condition is false and **neither** `completeJob` nor `failJob` runs → status stays `running`.

### Defect 2 — sync-job-repo.ts lines 39–51 (claim is a bare SELECT):

```ts
claimNextJob: () =>
  Effect.tryPromise({
    try: async () => {
      const [job] = await db
        .select()
        .from(syncJobs)
        .where(eq(syncJobs.status, 'pending'))
        .orderBy(syncJobs.createdAt)
        .limit(1);
      return job ?? null;
    },
```

`markRunning` (lines 53–62) is a separate UPDATE invoked later from `sync-engine.ts:68`.

### Defect 3 — bff/routes/sync.ts line 40:

```ts
await db.execute(sql`NOTIFY ${sql.raw(SYNC_JOBS_CHANNEL)}, ${job.id}`);
```

`SYNC_JOBS_CHANNEL` is `'sync_jobs_channel'` from `packages/shared/src/constants.ts`. The `${job.id}` becomes a bind parameter — invalid for `NOTIFY`. The parameterizable equivalent is the function form: `SELECT pg_notify('channel', 'payload')`.

Also relevant: the BFF dedupe check (sync.ts lines 12–29) looks for `pending`/`running` jobs but — unlike the worker's `hasPendingOrRunning` (sync-job-repo.ts lines 125–148) — has **no stale-job timeout**, which is what turns Defect 1 into a day-long outage.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `bun run typecheck` | exit 0 |
| Worker tests | `bun test packages/worker` | all pass |
| Full suite | `bun test --recursive` | all pass |
| Lint | `bun run lint` | exit 0 |
| Manual NOTIFY check (optional, needs `docker compose up -d` + `bun run db:push`) | `psql postgres://postgres:postgres@localhost:5432/dashboard -c "SELECT pg_notify('sync_jobs_channel','test')"` | one row, no error |

## Scope

**In scope** (the only files you should modify):
- `packages/worker/src/services/sync-engine.ts`
- `packages/worker/src/services/sync-job-repo.ts`
- `packages/worker/src/services/sync-engine.test.ts`
- `packages/bff/src/routes/sync.ts`

**Out of scope** (do NOT touch):
- `packages/worker/src/services/job-processor.ts` — the poll loop is correct; it just receives an already-claimed job after this plan.
- `packages/shared/src/db/schema.ts` — no schema change needed.
- The Slack notification logic.

## Git workflow

- Branch: `advisor/003-sync-job-pipeline-reliability`
- Commit per step; message style: imperative summary, e.g. `Fix sync job lifecycle: complete jobs with partial errors`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Fix the complete/fail decision in `sync-engine.ts`

Replace the `catchAll` + condition with an explicit either: if `runSync` **fails** (threw a typed error) → `failJob`; if it **succeeds** (even with accumulated per-user errors) → `completeJob`, always. Target shape:

```ts
const outcome = yield* Effect.either(runSync);

if (outcome._tag === 'Left') {
  const error = outcome.left;
  yield* jobRepo.failJob(jobId, error.message);
  yield* Effect.logError(`GitHub sync failed: ${error.message}`);
  const syncResult: SyncResult = { invited: [], removed: [], errors: [error.message] };
  yield* Effect.log(/* keep the existing "GitHub sync done" log line */);
  return syncResult;
}

const syncResult = outcome.right;
yield* jobRepo.completeJob(jobId, {
  syncType: 'github',
  startedAt,
  invitedCount: syncResult.invited.length,
  removedCount: syncResult.removed.length,
  errorCount: syncResult.errors.length,
  details: syncResult,
  triggeredBy: 'worker',
});
```

Keep the final `Effect.log("GitHub sync done: ...")` and `return syncResult` for both paths (as today). Semantics after this step: `failed` = the sync itself crashed; `completed` with `errorCount > 0` = ran, some per-user operations failed (counts are recorded in `sync_history` either way).

**Verify**: `bun test packages/worker/src/services/sync-engine.test.ts` → existing tests pass (the "handles invite failure gracefully" test exercises the partial-error path).

### Step 2: Add regression tests for the stuck-job bug

In `packages/worker/src/services/sync-engine.test.ts` (use the existing `makeJobRepoLayer` which records calls):

1. **errors-only sync completes the job**: workspace user `alice`, `inviteFailFor: ['alice']`, no members → result has 1 error, 0 invited/removed; assert `jobRepo.calls` contains a `completeJob` call with `errorCount: 1` and **no** `failJob` call.
2. **total failure fails the job**: make the Google layer fail (`getUsers: () => Effect.fail(new GoogleWorkspaceError({ message: 'boom' }))` — import `GoogleWorkspaceError` from `../lib/errors`); assert `failJob` was called and `completeJob` was not, and the returned result has `errors: ['boom']`.

**Verify**: `bun test packages/worker/src/services/sync-engine.test.ts` → all pass including 2 new.

### Step 3: Make the claim atomic in `sync-job-repo.ts`

Replace `claimNextJob`'s SELECT with a single atomic claim using Drizzle's `db.execute` raw SQL (the postgres driver is already in use):

```ts
claimNextJob: () =>
  Effect.tryPromise({
    try: async () => {
      const rows = await db.execute(sql`
        UPDATE sync_jobs SET status = 'running', started_at = now()
        WHERE id = (
          SELECT id FROM sync_jobs
          WHERE status = 'pending'
          ORDER BY created_at
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        RETURNING *
      `);
      // map snake_case row to the SyncJob shape, or re-select via Drizzle by id
      ...
    },
```

Implementation note: `db.execute` returns raw rows with snake_case columns. The simplest correct mapping that keeps types honest: take `rows[0]?.id`, and if present, re-fetch via `db.select().from(syncJobs).where(eq(syncJobs.id, id))` to return a properly typed `SyncJob`. (Two statements, but the *claim* — the UPDATE — is atomic; the re-select is read-only.) Return `null` when no row was claimed.

Then in `sync-engine.ts`, **remove** the `yield* jobRepo.markRunning(jobId)` call (line 68) — the claim now sets `running`. Keep `markRunning` in the repo interface and implementation (the BFF/`processGitHubSync` contract elsewhere doesn't use it, but removing interface members ripples into the test layer; just delete the call site). Update the test at `sync-engine.test.ts:175-185` ("marks job running then completes") to assert that the **first** recorded call is now `completeJob` (rename the test to "completes job after sync").

**Verify**: `bun test packages/worker` → all pass. `cd packages/worker && bunx tsc --noEmit` → exit 0.

### Step 4: Fix NOTIFY and add stale-job cleanup in the BFF route

In `packages/bff/src/routes/sync.ts`:

1. Replace line 40 with the parameterizable function form:

```ts
await db.execute(sql`SELECT pg_notify(${SYNC_JOBS_CHANNEL}, ${job.id})`);
```

(`pg_notify` accepts bound parameters; plain `NOTIFY` does not. `sql.raw` import usage may become unused — remove unused imports.)

2. Before the existing dedupe SELECT, add the same stale-running cleanup the worker repo uses (mirror `sync-job-repo.ts:129-138`):

```ts
await db
  .update(syncJobs)
  .set({ status: 'failed', completedAt: new Date(), result: { error: 'Timed out' } })
  .where(
    and(
      eq(syncJobs.type, 'github_sync'),
      eq(syncJobs.status, 'running'),
      sql`${syncJobs.startedAt} < NOW() - INTERVAL '10 minutes'`,
    ),
  );
```

This makes the dashboard self-healing even if a future lifecycle bug strands a job.

**Verify**: `cd packages/bff && bunx tsc --noEmit` → exit 0. If a local Postgres is available (`docker compose up -d`, `bun run db:push`), start the BFF (`bun run dev:bff`) and run `curl -s -X POST localhost:4000/api/sync/github` → HTTP 202 with `{"id":"...","status":"pending"}` and no 500; a second immediate call → 409.

## Test plan

- 2 new sync-engine tests (Step 2), 1 updated test (Step 3), modeled on the existing `sync-engine.test.ts` layer pattern.
- BFF route behavior (202/409/NOTIFY) gets automated coverage in plan 008 (route tests); here it's verified manually if Postgres is available, otherwise by typecheck only — note in your report which you did.
- Full gate: `bun test --recursive` → all pass.

## Done criteria

- [ ] `grep -n "catchAll" packages/worker/src/services/sync-engine.ts` → no match (replaced by `Effect.either`)
- [ ] `grep -n "markRunning" packages/worker/src/services/sync-engine.ts` → no match
- [ ] `grep -n "FOR UPDATE SKIP LOCKED" packages/worker/src/services/sync-job-repo.ts` → 1 match
- [ ] `grep -n "pg_notify" packages/bff/src/routes/sync.ts` → 1 match; `grep -n "sql.raw" packages/bff/src/routes/sync.ts` → no match
- [ ] `bun run typecheck` exits 0; `bun test --recursive` exits 0 with the 2 new tests
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the cited locations doesn't match the excerpts (drift).
- `Effect.either` typing fights you for more than one reasonable attempt (Effect version here is `^3.21.2`; `Effect.either` exists — if the returned tag isn't `'Left'`/`'Right'`, check `Either.isLeft` from `effect` instead, then stop if still stuck).
- The Drizzle `db.execute` raw-SQL claim can't be made to return/typecheck after one structural attempt — report the exact error; do not switch ORMs or add transactions speculatively.
- You're tempted to change `job-processor.ts` — out of scope.

## Maintenance notes

- After this plan, job statuses mean: `completed` (ran; check `errorCount`), `failed` (crashed or timed out), `running` (claimed, in flight ≤10 min). The dashboard UI may want to surface `errorCount > 0` as a warning state — deferred.
- If a second job type is added (e.g. `atlassian_sync` jobs), the claim query has no `type` filter — all workers claim all types; revisit then.
- Reviewer should scrutinize: the `Either` branch keeps writing `sync_history` exactly once per job (failJob writes one row, completeJob writes one row — never both).
