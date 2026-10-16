# Plan 012: Cut the N+1 GitHub API storms on the user-detail endpoints

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 635fc3c..HEAD -- packages/bff/src/services/github-teams.ts packages/bff/src/services/github-repos.ts`
> If either file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED (changes hot read paths the dashboard renders from; guarded by service tests)
- **Depends on**: plans/001-typecheck-and-ci.md; plans/008-bff-route-tests.md recommended first
- **Category**: perf
- **Planned at**: commit `635fc3c`, 2026-06-11

## Why this matters

Opening one user's detail page triggers `GET /:email/teams` and `GET /:email/repos` (`packages/bff/src/routes/users.ts:68-108`), which fan out as follows for an org with T teams and R repos:

- `listTeamsForUser` calls `listTeams()` — itself 1 + ⌈T/100⌉ list calls **plus one `getTeam(slug)` call per team** — then one `getMembershipForUserInOrg` call per team. ≈ 2T + 2 calls.
- `listDirectCollaboratorRepos` lists all repos, then paginates **collaborators for every repo**. ≈ R+ calls.
- `/repos` additionally calls `listTeamsForUser` *again* (users.ts:98) — the whole 2T fan-out is duplicated per page view.

For a 50-team, 100-repo org, one page view ≈ 300+ GitHub REST calls against a 5,000/hour token budget — slow pages now, hard rate-limit failures as the org grows. Two changes cut most of it without touching response shapes: (1) stop fetching per-team detail when the list payload already has the data; (2) add a small TTL cache for the org-wide snapshots (team list, repo collaborators) that every user-detail request re-fetches identically.

## Current state

- `packages/bff/src/services/github-teams.ts`:
  - `listTeams()` (lines 37–55): paginates `teams.list` collecting **only slugs**, then `Promise.all(slugs.map((slug) => this.getTeam(slug)))` — one extra API call per team. The `teams.list` response already contains `id, slug, name, description, privacy, html_url`; it lacks `members_count` / `repos_count` (those exist only on `getByName`).
  - `getTeam(slug)` (lines 57–75): `teams.getByName`, maps to `GitHubTeamDetail` (adds counts + timestamps).
  - `listTeamsForUser(username)` (lines 184–206): `listTeams()` then `Promise.allSettled` of `getMembershipForUserInOrg` per team; rejected = not a member (that's the membership filter).
  - `listTeamMembers(slug)` (lines 138–162): per-member `getMembershipForUserInOrg` to learn the role — also N+1 but bounded by team size; in scope only if time allows (see Step 4).
- `packages/bff/src/services/github-repos.ts`: `listDirectCollaboratorRepos(username)` (lines 214–254): `listRepos()` then per-repo paginated `repos.listCollaborators({ affiliation: 'direct' })`, filtering for the one username; throws "Not a direct collaborator" inside `allSettled` to drop non-matches.
- Consumers and their needs:
  - `routes/teams.ts` GET `/` needs the full `GitHubTeam` shape **including counts** (the teams table displays them).
  - `listTeamsForUser` feeds `routes/users.ts` → web `user-teams-card` — check `packages/web/src/lib/types.ts` `UserTeamMembership` for which fields the UI actually consumes; counts are part of the current response shape and must remain present (value accuracy for counts on *this* endpoint is not load-bearing for the UI, but don't change the shape).
- Existing service tests: `packages/bff/src/services/github-teams.test.ts` mocks `teams.list`, `teams.getByName`, `teams.getMembershipForUserInOrg` — these tests encode the current call pattern and WILL need updating in step 1 (that's expected; update them to the new pattern, keeping the assertion that only member teams are returned).
- Constraint: no Redis/external cache — in-process memory is fine (single BFF process via Bun.serve).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `bun run typecheck` | exit 0 |
| Service tests | `bun test packages/bff/src/services/` | all pass |
| Full suite | `bun test --recursive` | all pass |
| Lint | `bun run lint` | exit 0 |

## Scope

**In scope**:
- `packages/bff/src/services/github-teams.ts`
- `packages/bff/src/services/github-repos.ts`
- `packages/bff/src/services/ttl-cache.ts` (create)
- `packages/bff/src/services/github-teams.test.ts`, `github-repos.test.ts`, `ttl-cache.test.ts` (create/update)
- `packages/bff/src/routes/users.ts` — ONLY the duplicate `listTeamsForUser` call (Step 3)

**Out of scope** (do NOT touch):
- Response shapes of any endpoint — the web client parses them.
- Mutation paths (create/update/delete team, add/remove member, team access) — they're single calls already. BUT they must **invalidate** the cache (Step 2 covers it).
- GraphQL migration — bigger hammer than needed; note as future option only.
- The worker package.

## Git workflow

- Branch: `advisor/012-github-api-call-reduction`
- Commit per step; message style: imperative summary, e.g. `Drop per-team detail fetch from listTeams`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Build team lists from the `teams.list` payload (kills the per-team `getTeam`)

In `github-teams.ts`, change `listTeams()` to map the paginated `teams.list` rows directly into `GitHubTeam` (use `octokit.paginate(octokit.rest.teams.list, ...)` like `listTeamMembers` does, replacing the manual page loop). For `members_count`/`repos_count`, which `teams.list` omits: keep `listTeams()` returning them by fetching details **only where a consumer actually needs counts**. Concretely:

- Add `listTeamsBasic(): Promise<GitHubTeam[]>` (no detail calls; set `membersCount`/`reposCount` to `0`) — internal building block.
- `listTeams()` (used by `routes/teams.ts` for the teams table, which displays counts) keeps current behavior: `listTeamsBasic()` + per-team `getTeam` enrichment. Unchanged externally.
- `listTeamsForUser()` switches to `listTeamsBasic()` — membership filtering needs slugs only; the response keeps the same fields (counts present but `0`). **Check first** that the web UI's user-teams card doesn't display member counts: `grep -n "membersCount\|reposCount" packages/web/src/components/users/user-teams-card.tsx` — if it DOES display them, instead enrich only the (few) teams the user belongs to, after the membership filter: `Promise.all(memberTeams.map(t => this.getTeam(t.slug)))`. Either way the per-team fan-out drops from "all teams" to "user's teams".

Update `github-teams.test.ts` to the new call pattern (it currently expects `getByName` per listed team).

**Verify**: `bun test packages/bff/src/services/github-teams.test.ts` → pass; the test asserting `listTeamsForUser` must show `getByName` called at most once per *member* team (or zero), not per org team.

### Step 2: TTL cache for org-wide snapshots

Create `packages/bff/src/services/ttl-cache.ts` — a minimal generic helper (~30 lines):

```ts
export class TtlCache<T> {
  constructor(private readonly ttlMs: number) {}
  private entry: { value: T; at: number } | null = null;
  async get(load: () => Promise<T>): Promise<T> { /* return fresh or reload */ }
  invalidate(): void { this.entry = null; }
}
```

Apply with a 60-second TTL (fresh enough for an admin tool, kills same-minute storms):

- `GitHubTeamsService`: cache the `listTeams()` result (the enriched org-wide list). `createTeam`/`updateTeam`/`deleteTeam` call `invalidate()`.
- `GitHubReposService`: cache `listRepos()` and add a per-service `TtlCache` holding a `Map<repoName, collaborators[]>` built by `listDirectCollaboratorRepos`'s fan-out, so the second user's page view within the TTL reuses it. `addCollaborator`/`removeCollaborator` (and team-access mutations) call `invalidate()`.

Write `ttl-cache.test.ts`: returns cached value within TTL (loader called once for two gets); reloads after expiry (inject a fake clock via an optional `now: () => number` constructor arg rather than sleeping); `invalidate()` forces reload; concurrent `get`s while loading don't double-load (single-flight: store the in-flight promise).

**Verify**: `bun test packages/bff/src/services/` → all pass, including ≥4 cache tests.

### Step 3: Drop the duplicated team fan-out in `/users/:email/repos`

`routes/users.ts:98` calls `listTeamsForUser(githubUsername)` again after `/teams` already did. With Step 2's cache this is mostly absorbed, but the membership-check fan-out (per-team) still repeats. Cheapest correct fix within scope: nothing structural — the route legitimately needs the team list for `listReposViaTeams`. Just confirm after Steps 1–2 that the second call hits the cached basic list (membership checks remain per user's-teams). If you find membership-check results worth caching too, do NOT — per-user TTL caching of authorization-ish data is where staleness bites; leave it.

**Verify**: read-only confirmation; note in the report how many API calls a user-detail view now costs (count the mock invocations in a quick test: for T teams of which the user is in K, expect ⌈T/100⌉ list pages + T membership checks + (0 or K) detail fetches, amortized to just T membership checks on warm cache).

### Step 4 (optional, only if everything above is green and quick): `listTeamMembers` role fetch

`teams.listMembersInOrg` supports `role: 'maintainer' | 'member' | 'all'` as a request filter. Replace the per-member `getMembershipForUserInOrg` with two paginated list calls (`role: 'maintainer'`, then `role: 'member'`) and tag roles from which list each login came. Update its tests. Skip this step entirely if anything is uncertain — it's a bonus.

**Verify**: `bun test packages/bff/src/services/` → all pass.

## Test plan

- Updated `github-teams.test.ts` (call-pattern assertions), new `ttl-cache.test.ts` (4 cases incl. single-flight), `github-repos.test.ts` extended with one cache-hit case (collaborator map reused within TTL, loader called once).
- Full gate: `bun run typecheck` + `bun test --recursive` green.

## Done criteria

- [ ] `listTeamsForUser` no longer fetches per-org-team details (test asserts the call pattern)
- [ ] `TtlCache` exists with single-flight semantics and tests; team/repo mutations invalidate it
- [ ] Response shapes unchanged: `git diff packages/web` is empty, and route tests from plan 008 (if present) pass unmodified
- [ ] `bun run typecheck` exits 0; `bun test --recursive` exits 0; `bun run lint` exits 0
- [ ] Report includes the before/after call-count estimate for one user-detail view
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The service files don't match the excerpts (drift).
- The web UI turns out to render `membersCount` on the user-teams card AND enriching only member teams still breaks an existing test's expectations — pause and report which consumer needs what.
- You're tempted to cache per-user membership/permission results — explicitly forbidden above.
- Octokit's `paginate` typing fights the `role` filter in Step 4 — skip Step 4, it's optional.

## Maintenance notes

- The 60s TTL is a guess; tune with real usage. If the BFF ever runs multiple replicas, the in-process cache becomes per-replica (acceptable) but invalidation stops being global — revisit then.
- The real long-term fix for collaborator fan-out is GitHub's GraphQL API (one query for repos-with-collaborator) — deliberately deferred; REST + cache is enough at current org size.
- Reviewer: check every mutation path in both services calls `invalidate()` — a stale team list after "create team" is the regression users will actually notice.
