# Plan 004: Fix merged activity-feed pagination (page 2+ currently shows wrong entries)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 635fc3c..HEAD -- packages/bff/src/routes/activity.ts`
> If the file changed since this plan was written, compare the "Current
> state" excerpt against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/001-typecheck-and-ci.md
- **Category**: bug
- **Planned at**: commit `635fc3c`, 2026-06-11

## Why this matters

The activity page is the dashboard's audit trail. In the unfiltered view, `GET /api/activity` fetches `sync_history` and `audit_log` **each with the same per-table `offset`**, merges, sorts, and slices to `limit`. Per-table offsets don't compose into a merged timeline: page 2 skips entries that should appear and repeats ones that shouldn't, so an operator paging through history sees duplicated and missing audit events. Filtered views (`?type=sync`, `?type=action`) are correct and stay unchanged.

## Current state

- `packages/bff/src/routes/activity.ts` — the whole feature: row formatters (`syncRowToEntry`, `actionRowToEntry`), per-table fetchers, and the route handler. The buggy merge path (lines 115–130, verbatim):

```ts
// No filter: fetch both, merge by timestamp, trim to page size
const [sync, action] = await Promise.all([
  fetchSyncEntries(limit, offset),
  fetchActionEntries(limit, offset),
]);

const items = [...sync.items, ...action.items]
  .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  .slice(0, limit);

return c.json({ items, page, limit, totalCount: sync.count + action.count });
```

- The fetchers (lines 82–96) take `(limit, offset)` and also return the table's total `count`.
- `limit` is clamped to ≤100 and `page` ≥1 at lines 100–103; `offset = (page - 1) * limit`.
- Consumer: `packages/web/src/lib/api-client.ts` `getActivity()` → response shape `{ items, page, limit, totalCount }` must not change.
- This is an internal admin tool; both tables hold at most thousands of rows. The simple correct fix — over-fetch and slice in memory — is appropriate. Do not build a SQL `UNION` view.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `bun run typecheck` | exit 0 |
| New tests | `bun test packages/bff/src/routes/activity.test.ts` | all pass |
| Full suite | `bun test --recursive` | all pass |
| Lint | `bun run lint` | exit 0 |

## Scope

**In scope** (the only files you should modify/create):
- `packages/bff/src/routes/activity.ts`
- `packages/bff/src/routes/activity.test.ts` (create)

**Out of scope** (do NOT touch):
- The response shape `{ items, page, limit, totalCount }` — the web app depends on it.
- The `?type=sync` / `?type=action` branches — already correct.
- `packages/web/**` — no client change needed.

## Git workflow

- Branch: `advisor/004-activity-merged-pagination`
- Commit style: imperative summary, e.g. `Fix merged activity pagination: window the merged timeline, not per-table offsets`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Extract a pure merge-window helper

In `activity.ts`, add an exported pure function (exported so the test can hit it directly without mocking the DB):

```ts
export function mergeActivityPage(
  sync: ActivityEntry[],
  action: ActivityEntry[],
  page: number,
  limit: number,
): ActivityEntry[] {
  const offset = (page - 1) * limit;
  return [...sync, ...action]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(offset, offset + limit);
}
```

### Step 2: Fix the merge branch

In the no-filter branch, fetch the first `offset + limit` rows of **each** table (offset 0) so the merged window is fully covered, then apply the helper:

```ts
const window = offset + limit;
const [sync, action] = await Promise.all([
  fetchSyncEntries(window, 0),
  fetchActionEntries(window, 0),
]);

const items = mergeActivityPage(sync.items, action.items, page, limit);

return c.json({ items, page, limit, totalCount: sync.count + action.count });
```

Note `window` can reach `100 * page`; with the limit clamp of 100 this stays bounded and fine for an admin tool.

**Verify**: `cd packages/bff && bunx tsc --noEmit` → exit 0.

### Step 3: Tests for the helper

Create `packages/bff/src/routes/activity.test.ts` using `bun:test`. The helper is pure — no mocks needed. Build entries with a small factory `entry(id, isoTimestamp)`. Cases:

1. **Interleaving**: 3 sync + 3 action entries with alternating timestamps, `page=1, limit=4` → returns the 4 newest across both sources, sorted descending.
2. **Page 2 correctness (the regression)**: same 6 entries, `limit=2` — collect pages 1–3 and assert their concatenation equals the full sorted merge with **no duplicates and no gaps** (this exact property is what the old code violated).
3. **Last partial page**: 5 total entries, `limit=2, page=3` → 1 entry.
4. **Beyond the end**: `page=4` → `[]`.

If `mock.module` is straightforward in your environment you may *additionally* test the route via `activityRoutes.request('/')` with a mocked `../db`, but the pure-helper tests are the required gate (full route coverage arrives with plan 008).

**Verify**: `bun test packages/bff/src/routes/activity.test.ts` → 4 pass.

## Test plan

Covered in Step 3. Full gate: `bun test --recursive` → all pass, 4 new.

## Done criteria

- [ ] In `activity.ts`, the no-filter branch contains no per-table `offset` fetch (`fetchSyncEntries(limit, offset)` pattern gone); `grep -n "slice(0, limit)" packages/bff/src/routes/activity.ts` → no match
- [ ] `mergeActivityPage` exists, is exported, and is used by the route
- [ ] `bun run typecheck` exits 0; `bun test --recursive` exits 0 with 4 new tests
- [ ] `bun run lint` exits 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The merge branch doesn't match the excerpt (drift).
- You find the web client relying on per-table pagination semantics (it shouldn't — it only reads `items`/`totalCount`), which would make this a coordinated change.

## Maintenance notes

- The over-fetch grows linearly with page number; if either table grows past ~10k rows AND deep paging becomes a real usage pattern, replace with a SQL `UNION ALL ... ORDER BY ts LIMIT/OFFSET` query — the helper's tests then become the spec.
- `totalCount` counts both tables; the UI computes page count from it — that stays correct with this fix.
- Reviewer: check the `slice(offset, offset + limit)` bounds and that filtered branches were left untouched.
