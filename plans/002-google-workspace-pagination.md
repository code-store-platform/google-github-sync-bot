# Plan 002: Paginate Google Workspace user listing so orgs >300 users don't get members wrongly removed from GitHub

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 635fc3c..HEAD -- packages/worker/src/services/google-workspace.ts packages/bff/src/services/google-workspace.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/001-typecheck-and-ci.md (verification gates)
- **Category**: bug
- **Planned at**: commit `635fc3c`, 2026-06-11

## Why this matters

Both copies of the Google Workspace service fetch users with a single API call capped at `maxResults: 300` and never read `nextPageToken`. The worker's sync engine (`packages/worker/src/services/sync-engine.ts:49-58`) **removes every GitHub org member whose username isn't in the fetched workspace set**. So the moment the workspace passes 300 users, everyone on page 2+ silently looks "not in workspace" and gets removed from the GitHub organization on the next sync. The same truncation makes users invisible in the dashboard user list. This is the highest-severity correctness bug in the repo.

## Current state

- `packages/worker/src/services/google-workspace.ts` — Effect.ts service used by the sync engine. The fetch (lines 43–50):

```ts
const response = await directory.users.list({
  customer: 'my_customer',
  projection: 'full',
  viewType: 'admin_view',
  maxResults: 300,
});

return (response.data.users || []) as GoogleUser[];
```

- `packages/bff/src/services/google-workspace.ts` — plain async functions used by dashboard routes. `getWorkspaceUsers` (lines 48–56) has the identical single call with `maxResults: 300`.
- The Google Admin SDK Directory API (`directory.users.list`) caps `maxResults` at 500 and returns `nextPageToken` in `response.data` when more pages exist; pass it back as `pageToken` to get the next page.
- These two files are intentionally still duplicated (consolidation is plan 011). **Fix both copies identically.**
- Worker test conventions: see `packages/worker/src/services/sync-engine.test.ts` — `bun:test` + Effect `Layer.succeed` mocks. BFF test conventions: see `packages/bff/src/services/github-teams.test.ts` — `bun:test` with `mock.module()` to stub `../lib/config` and SDK modules, then `await import('./<module>')`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `bun run typecheck` | exit 0 |
| All tests | `bun test --recursive` | all pass, 0 fail |
| Just new tests | `bun test packages/bff/src/services/google-workspace.test.ts packages/worker/src/services/google-workspace.test.ts` | all pass |
| Lint | `bun run lint` | exit 0 |

## Scope

**In scope** (the only files you should modify/create):
- `packages/worker/src/services/google-workspace.ts`
- `packages/bff/src/services/google-workspace.ts`
- `packages/worker/src/services/google-workspace.test.ts` (create)
- `packages/bff/src/services/google-workspace.test.ts` (create)

**Out of scope** (do NOT touch):
- `packages/worker/src/services/sync-engine.ts` — its removal logic is correct once it receives the full user list.
- `getWorkspaceUser` and `updateUserCustomSchema` in the BFF service — single-user calls, no pagination involved.
- Consolidating the two services — that's plan 011.

## Git workflow

- Branch: `advisor/002-google-workspace-pagination`
- Commit style: imperative summary, e.g. `Fix Google Workspace user fetch: paginate past 300 users`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Paginate in the worker service

In `packages/worker/src/services/google-workspace.ts`, replace the single `directory.users.list` call inside `getUsers` with a loop. Target shape:

```ts
const users: GoogleUser[] = [];
let pageToken: string | undefined;

do {
  const response = await directory.users.list({
    customer: 'my_customer',
    projection: 'full',
    viewType: 'admin_view',
    maxResults: 500,
    pageToken,
  });
  users.push(...((response.data.users || []) as GoogleUser[]));
  pageToken = response.data.nextPageToken ?? undefined;
} while (pageToken);

return users;
```

Keep the surrounding `Effect.tryPromise` / `GoogleWorkspaceError` wrapping exactly as is — a failure on any page must still surface as `GoogleWorkspaceError` (which makes the sync engine fail the job rather than act on a partial list; that behavior is load-bearing).

**Verify**: `cd packages/worker && bunx tsc --noEmit` → exit 0.

### Step 2: Paginate in the BFF service

Apply the same loop to `getWorkspaceUsers` in `packages/bff/src/services/google-workspace.ts`, preserving its existing `try/catch` + `console.error` + rethrow style.

**Verify**: `cd packages/bff && bunx tsc --noEmit` → exit 0.

### Step 3: Worker test

Create `packages/worker/src/services/google-workspace.test.ts`. The service builds its own `googleapis` client internally, so use the `mock.module` pattern from `packages/bff/src/services/github-teams.test.ts`: mock `../lib/config` (provide `GOOGLE_APPLICATION_CREDENTIALS: '{}'`, `GOOGLE_ADMIN_EMAIL: 'admin@test.com'`) and mock `googleapis` so `google.admin()` returns `{ users: { list: mockList } }` and `google.auth.GoogleAuth` is a no-op class. Then `await import('./google-workspace')` and run `GoogleWorkspaceServiceLive`'s `getUsers` via `Effect.runPromise(Effect.provide(...))`.

Cases:
1. Two pages: first `mockList` call resolves `{ data: { users: [u1, u2], nextPageToken: 'p2' } }`, second resolves `{ data: { users: [u3] } }` → result has 3 users, `mockList` called twice, second call received `pageToken: 'p2'`.
2. Single page without `nextPageToken` → one call, users returned.
3. `users` missing in response (`{ data: {} }`) → returns `[]`.
4. Second page rejects → the Effect fails with `GoogleWorkspaceError` (assert via `Effect.either` returning a Left), and no partial list is returned.

**Verify**: `bun test packages/worker/src/services/google-workspace.test.ts` → 4 pass.

### Step 4: BFF test

Create `packages/bff/src/services/google-workspace.test.ts` with the same `mock.module('googleapis', ...)` + `mock.module('../lib/config', ...)` approach, covering cases 1–3 above for `getWorkspaceUsers` and case 4 asserting the promise rejects.

**Verify**: `bun test packages/bff/src/services/google-workspace.test.ts` → 4 pass.

## Test plan

Covered by Steps 3–4 (8 new tests). Full-suite gate: `bun test --recursive` → previous 40 tests plus the 8 new ones all pass.

## Done criteria

- [ ] `grep -n "maxResults" packages/*/src/services/google-workspace.ts` shows `500` (or another value) **with** a `pageToken` loop in both files; `grep -n "nextPageToken" packages/*/src/services/google-workspace.ts` matches in both files
- [ ] `bun run typecheck` exits 0
- [ ] `bun test --recursive` exits 0 with 8 new tests
- [ ] `bun run lint` exits 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The fetch code at either location doesn't match the excerpts (drift).
- Mocking `googleapis` via `mock.module` doesn't intercept the import (e.g. because the module instantiates clients at import time in a way the mock can't reach) after one structural fix attempt — report what you observed rather than restructuring the service.
- You find yourself wanting to change `sync-engine.ts` semantics to "be safe about partial lists" — out of scope; the error-propagation behavior already handles it.

## Maintenance notes

- Plan 011 (service consolidation) will merge these two implementations; whoever executes it must carry this pagination over and keep these tests.
- Reviewer should check the failure path: a page-2 error must fail the whole fetch, never return a partial list (a partial list re-creates the removal bug this plan fixes).
- If the workspace ever exceeds a few thousand users, consider the `query` parameter server-side filtering instead of fetching everything.
