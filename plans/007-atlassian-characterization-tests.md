# Plan 007: Characterization tests for the Atlassian suspend/delete logic

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 635fc3c..HEAD -- packages/worker/src/services/atlassian/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW (tests + a minimal constructor seam; no behavior change)
- **Depends on**: plans/001-typecheck-and-ci.md
- **Category**: tests
- **Planned at**: commit `635fc3c`, 2026-06-11

## Why this matters

`WorkspaceAtlassianSync` **suspends and permanently deletes real employee Atlassian accounts** based on email matching, a hardcoded domain filter, stop lists, and 90/180-day inactivity thresholds — and it has zero tests. A bug in any filter (an off-by-one on the threshold, a normalization mismatch, an inverted status check) suspends or deletes the wrong people. These are characterization tests: they pin down current behavior so future refactors (including plan 011's service consolidation) can't silently change who gets suspended or deleted. **This plan must not change any runtime behavior** — the only production-code edit allowed is a dependency-injection seam in the constructor.

## Current state

- `packages/worker/src/services/atlassian/sync.ts` — the class under test. Key behavior (read the whole file before starting):
  - Constructor (lines 30–36): `new AtlassianApiClient()` created internally; `suspendStopList` from `envVars.ATLASSIAN_SUSPEND_STOP_LIST` (normalized emails); `dryRun` from `envVars.ATLASSIAN_DRY_RUN`.
  - `syncSuspensions(workspaceUsers)` (lines 63–94): suspends Atlassian users whose normalized email ends with `@code.store`, whose `account_status === 'active'`, who are NOT in the Google workspace email set, and NOT on the stop list. Calls `api.suspendUser(account_id)` unless `dryRun`. Per-user errors are accumulated into `result.errors`, not thrown.
  - `check3MonthInactivity` / `check6MonthInactivity` (lines 96–116) delegate to `checkInactivity(users, 90, 'active', 'suspend')` and `(users, 180, 'inactive', 'delete')`.
  - `checkInactivity` (lines 118–194): filters by `account_status`; skips stop-list and workspace members; per user calls `api.getUserLastActive(account_id)`, then sleeps `RATE_LIMIT_DELAY_MS = 2000` (line 147–149 — **this is why the seam is needed**: 2s per user makes tests unbearably slow); skips users with no `product_access` or no parseable timestamps; computes `daysSince` from the **most recent** `last_active_timestamp`; acts only when `daysSince > thresholdDays` (strict, not `>=`); `suspend` action → `api.suspendUser`, `delete` action → `api.deleteUser`, both skipped under `dryRun` but **still recorded in the result arrays**.
  - Caching (lines 48–61): `getAtlassianUsersWithCache` caches `api.getOrganizationUsers()` for 10 min; `clearCache()` resets.
- `packages/worker/src/services/atlassian/api-client.ts` — `AtlassianApiClient` with `getOrganizationUsers(): Promise<AtlassianUser[]>`, `getUserLastActive(accountId)`, `suspendUser(accountId)`, `deleteUser(accountId)`. `AtlassianUser` has `email`, `account_id`, `account_status` fields. `getUserLastActive` resolves `{ data: { product_access: [{ last_active_timestamp: string }, ...] } }`.
- `normalizeEmail` from `@google-github-sync/shared/utils` lower-cases/trims.
- `GoogleUser` type from `../google-workspace` — only `primaryEmail` matters here.
- Test conventions: `bun:test`; config mocking pattern in `packages/bff/src/services/github-teams.test.ts` (`mock.module('../lib/config', ...)` **before** `await import(...)` of the module under test). Note the config path from the atlassian dir is `../../lib/config`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `bun run typecheck` | exit 0 |
| New tests | `bun test packages/worker/src/services/atlassian/sync.test.ts` | all pass, total runtime < 5s |
| Full suite | `bun test --recursive` | all pass |
| Lint | `bun run lint` | exit 0 |

## Scope

**In scope**:
- `packages/worker/src/services/atlassian/sync.test.ts` (create)
- `packages/worker/src/services/atlassian/sync.ts` — **constructor seam only** (Step 1); no other lines may change.

**Out of scope** (do NOT touch):
- `packages/worker/src/services/atlassian/api-client.ts` — including its URLs (the `deleteUser` endpoint `api.atlassian.com/users/{id}/manage/lifecycle/delete` is the documented Atlassian user-management lifecycle API; a previous audit wrongly flagged it).
- Any filtering/threshold/caching logic — if a test reveals behavior you believe is a bug (see candidates below), **record it in the test name as `documents current behavior:`** and report it; do not fix it here.
- `packages/worker/src/index.ts` — the cron wiring.

## Git workflow

- Branch: `advisor/007-atlassian-characterization-tests`
- Commit style: imperative summary, e.g. `Add characterization tests for Atlassian suspend/delete logic`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add an injection seam to the constructor

Change the constructor of `WorkspaceAtlassianSync` to accept optional overrides, preserving default behavior exactly:

```ts
constructor(options?: { api?: AtlassianApiClient; rateLimitDelayMs?: number }) {
  this.api = options?.api ?? new AtlassianApiClient();
  this.rateLimitDelayMs =
    options?.rateLimitDelayMs ?? WorkspaceAtlassianSync.RATE_LIMIT_DELAY_MS;
  this.suspendStopList = envVars.ATLASSIAN_SUSPEND_STOP_LIST.map((email) =>
    normalizeEmail(email),
  );
  this.dryRun = envVars.ATLASSIAN_DRY_RUN || false;
}
```

Add `private readonly rateLimitDelayMs: number;` and use it at the sleep site (line ~148) instead of the static. The static constant stays as the default. No call site changes (`packages/worker/src/index.ts:50` calls `new WorkspaceAtlassianSync()` — still valid).

**Verify**: `cd packages/worker && bunx tsc --noEmit` → exit 0; `bun test --recursive` → all existing tests still pass.

### Step 2: Test scaffolding

Create `packages/worker/src/services/atlassian/sync.test.ts`. Order matters: `mock.module` before importing the module under test.

```ts
import { describe, expect, test, mock } from 'bun:test';

mock.module('../../lib/config', () => ({
  envVars: {
    ATLASSIAN_SUSPEND_STOP_LIST: ['Protected@code.store'],
    ATLASSIAN_DRY_RUN: false,
    // include any other keys the module chain reads; start minimal, add on failure
  },
}));

const { WorkspaceAtlassianSync } = await import('./sync');
```

Build a `makeFakeApi()` helper returning an object with `mock()` functions for `getOrganizationUsers`, `getUserLastActive`, `suspendUser`, `deleteUser` (cast to `AtlassianApiClient` via `as unknown as`), plus factories:

- `atlassianUser(email, status = 'active')` → `{ email, account_id: 'id-' + email, account_status: status }` (match the real `AtlassianUser` field names from `api-client.ts` — check the exported type and include any other required fields).
- `googleUser(email)` → `{ primaryEmail: email }`.
- `lastActive(daysAgo)` → `{ data: { product_access: [{ last_active_timestamp: new Date(Date.now() - daysAgo * 86_400_000).toISOString() }] } }`.

Always construct with `new WorkspaceAtlassianSync({ api: fakeApi, rateLimitDelayMs: 0 })`.

### Step 3: `syncSuspensions` characterization

Cases (each asserts both the returned result AND which api mocks were called):

1. Active `@code.store` Atlassian user not in workspace → suspended (in `result.suspended`, `suspendUser` called with their `account_id`).
2. Same user present in workspace (`googleUser('same@code.store')`) → not suspended.
3. Email-case insensitivity: Atlassian `Bob@Code.Store` vs workspace `bob@code.store` → not suspended (normalization works).
4. Non-`@code.store` domain → never suspended (documents the hardcoded domain filter).
5. Already-suspended user (`account_status: 'suspended'`) → skipped.
6. Stop-list user `protected@code.store` → skipped (also proves stop-list normalization).
7. `suspendUser` rejects for one of two candidates → other still suspended; one entry in `result.errors`; nothing thrown.

### Step 4: `checkInactivity` characterization (via `check3MonthInactivity` / `check6MonthInactivity`)

All subjects must be non-workspace, non-stop-list `@code.store`... note: **`checkInactivity` has no domain filter** — unlike `syncSuspensions`, it considers ALL Atlassian users regardless of domain. Write a test documenting exactly that difference (`documents current behavior: inactivity checks are not limited to @code.store`).

1. Active user, last active 91 days ago → `check3MonthInactivity` suspends; entry has `inactiveDays: 91` and an ISO `lastActiveDate`.
2. Boundary: exactly 90 days → NOT suspended (strict `>`); 90.x-day cases — use `daysAgo: 90` and `daysAgo: 91` only, the code floors days.
3. Active user inactive 200 days → `check3MonthInactivity` suspends (suspend path checks `active` accounts); `check6MonthInactivity` does NOT touch them (it filters `account_status !== 'active'` — document this interplay: only already-suspended accounts get deleted).
4. Suspended user inactive 181 days → `check6MonthInactivity` deletes (in `result.deleted`, `deleteUser` called).
5. Multiple `product_access` entries → most recent timestamp wins (one entry 200 days ago, one 10 days ago → no action).
6. No `product_access` / empty array / empty-string timestamps → skipped, no action, no error.
7. Workspace member and stop-list user → skipped even when long inactive.
8. `getUserLastActive` rejects for user A but resolves for user B → B still processed; A in `errors`.

### Step 5: dry-run and caching

1. Re-mock config with `ATLASSIAN_DRY_RUN: true` — `mock.module` re-registration within the same file is unreliable across imports; instead put dry-run tests in a **separate file** `sync.dry-run.test.ts` with its own `mock.module` block. Cases: `syncSuspensions` and `check6MonthInactivity` record candidates in `suspended`/`deleted` but `suspendUser`/`deleteUser` are **never called**.
2. Caching (back in `sync.test.ts`): two consecutive `syncSuspensions` calls → `getOrganizationUsers` called once; after `clearCache()` → called again.

**Verify (steps 3–5)**: `bun test packages/worker/src/services/atlassian/` → all pass in < 5s (if it takes ~minutes, the delay seam isn't wired — fix Step 1).

## Test plan

This plan IS the test plan: ~20 tests across `sync.test.ts` and `sync.dry-run.test.ts`, structured per steps 3–5, using the `mock.module` pattern from `packages/bff/src/services/github-teams.test.ts`. Gate: `bun test --recursive` all green.

## Done criteria

- [ ] `packages/worker/src/services/atlassian/sync.test.ts` and `sync.dry-run.test.ts` exist with the case coverage of Steps 3–5 (≥18 tests)
- [ ] `git diff packages/worker/src/services/atlassian/sync.ts` shows ONLY the constructor seam + delay-field change (no filter/threshold logic touched)
- [ ] `bun test packages/worker/src/services/atlassian/` completes in < 5 seconds
- [ ] `bun run typecheck` exits 0; `bun test --recursive` exits 0; `bun run lint` exits 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated; any `documents current behavior:` surprises listed in your report

## STOP conditions

Stop and report back (do not improvise) if:

- `sync.ts` doesn't match the described behavior (drift).
- The config mock can't satisfy the import chain after two attempts (e.g. `envVars` validation runs at import of an unrelated module) — report the exact import that fails.
- A test reveals behavior so dangerous you believe it must not be pinned (e.g. it would delete workspace members) — report it as a finding instead of writing the pinning test.

## Maintenance notes

- These tests are the safety net for plan 011 and any future Atlassian refactor. Treat a failing characterization test as "behavior changed", not "test is stale".
- Candidate bugs these tests will *document* (each needs a product decision before fixing): the missing domain filter in `checkInactivity`; `check3MonthInactivity` re-suspending long-inactive users that `syncSuspensions` ignores by domain; deletion requiring prior suspension (status `!== 'active'`).
- Reviewer: confirm zero behavior change in `sync.ts` and that no test sleeps real seconds.
