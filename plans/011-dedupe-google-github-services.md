# Plan 011: Consolidate the duplicated Google/GitHub service logic into `packages/shared`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 635fc3c..HEAD -- packages/bff/src/services/google-workspace.ts packages/bff/src/services/github-membership.ts packages/worker/src/services/google-workspace.ts packages/worker/src/services/github.ts packages/shared/src/`
> Plan 002 changes both google-workspace files (pagination) — that drift is
> expected and REQUIRED (see Depends on). Read the live files; the
> consolidated code must carry the pagination forward.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED (touches the sync engine's data sources; mitigated by the test suites from plans 002/003/008)
- **Depends on**: plans/002-google-workspace-pagination.md (MUST be DONE — consolidating the unfixed copies re-spreads the bug); plans/008-bff-route-tests.md (safety net); plan 007 recommended first
- **Category**: tech-debt
- **Planned at**: commit `635fc3c`, 2026-06-11

## Why this matters

The Google Workspace user fetch and the GitHub org-membership reads are implemented twice: once as plain async functions in the BFF, once as Effect.ts layers in the worker, with near-identical bodies (same API calls, same pagination, same normalization). The >300-users pagination bug existed in **both** copies — concrete proof that every fix must currently be made twice and can be missed once. This plan moves the API-calling core into `packages/shared` as plain async functions; the worker keeps its Effect layers as thin wrappers, the BFF calls the functions directly. Public behavior of both packages is unchanged.

## Current state

The duplicated pairs (read all four live files first):

- **Google users list**:
  - `packages/bff/src/services/google-workspace.ts` — `createGoogleAuth()` (readonly scope), `createGoogleAuthReadWrite()`, `getWorkspaceUsers(auth)`, `getWorkspaceUser(auth, email)`, `updateUserCustomSchema(email, username)`; plain async + `console.error`. Exports a `GoogleUser` type.
  - `packages/worker/src/services/google-workspace.ts` — `GoogleWorkspaceService` Effect `Context.Tag` with a single `getUsers()`, wrapping the same `directory.users.list` call in `Effect.tryPromise` → `GoogleWorkspaceError`. Exports its own structurally identical `GoogleUser` type.
- **GitHub membership reads**:
  - `packages/bff/src/services/github-membership.ts` — class `GitHubMembershipService` with `getMemberUsernames()` / `getInvitedUsernames()` (Octokit paginate + `normalizeGitHubUsername`).
  - `packages/worker/src/services/github.ts` — `GitHubService` Effect tag with the same two reads (verbatim logic) plus worker-only `inviteUser` / `removeMember` / `getUserId`.
- Consumers:
  - BFF: `routes/users.ts` (module-level `const auth = createGoogleAuth()` + service instances), `routes/sync.ts` (no Google/GitHub), other routes use `GitHubTeamsService`/`GitHubReposService` (NOT in scope — they have no worker twin).
  - Worker: `sync-engine.ts` consumes both tags; `index.ts` provides `GoogleWorkspaceServiceLive`, `GitHubServiceLive`; `atlassian` code imports `GoogleUser` from `../google-workspace`.
- Shared package: `packages/shared/src/` has `utils.ts` (`normalizeGitHubUsername`, `normalizeEmail`, `getGitHubUsername`), `constants.ts`, `db/`. Check `packages/shared/package.json` for the `exports` map pattern before adding a subpath; `googleapis` and `octokit` must be ADDED to shared's `dependencies` (they're currently in bff/worker manifests; keep them there too — the wrappers still import types).
- Config constraint: shared must stay env-free. The current services read `envVars` at module/closure scope. The consolidated functions must take explicit parameters (credentials JSON string, admin email, token, org name) — each package keeps its own config module and passes values in.
- Test suites guarding this refactor: `packages/worker/src/services/sync-engine.test.ts` (mocks at the Effect-tag level — unaffected), `packages/bff/src/services/github-teams.test.ts` (different service — unaffected), plan 002's google-workspace tests (will need their `mock.module` paths updated to wherever the fetch code lands — budget for this), plan 008's route tests (mock at `../services/*` seams — the BFF service modules keep existing as re-export/wiring points, so those mocks keep working).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `bun run typecheck` | exit 0 |
| Full suite | `bun test --recursive` | all pass, same count as before the refactor |
| Lint | `bun run lint` | exit 0 |
| Duplication gone | `grep -rn "directory.users.list" packages/bff/src packages/worker/src` | no matches (only shared) |

## Scope

**In scope**:
- `packages/shared/src/services/google-directory.ts` (create), `packages/shared/src/services/github-org.ts` (create), `packages/shared/src/index.ts` / `package.json` (exports), shared `package.json` deps
- `packages/bff/src/services/google-workspace.ts`, `packages/bff/src/services/github-membership.ts` (become thin wrappers)
- `packages/worker/src/services/google-workspace.ts`, `packages/worker/src/services/github.ts` (Effect layers delegate to shared)
- Test files whose `mock.module` targets move (plan 002's tests)

**Out of scope** (do NOT touch):
- `GitHubTeamsService` / `GitHubReposService` (BFF-only, no twin — nothing to dedupe).
- `sync-engine.ts`, `job-processor.ts`, all routes — consumer code must not change (that's the point: the seams stay).
- The Effect error types (`GoogleWorkspaceError`, `GitHubError`) — they stay in the worker.
- Behavior changes of any kind, including "improving" error messages.

## Git workflow

- Branch: `advisor/011-dedupe-google-github-services`
- Commit per step; message style: imperative summary, e.g. `Extract Google directory client into shared package`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Shared Google directory module

Create `packages/shared/src/services/google-directory.ts` with the `GoogleUser` type (single source of truth) and parameterized functions:

```ts
export type GoogleDirectoryConfig = {
  credentialsJson: string;
  adminEmail: string;
};

export function createDirectoryClient(config: GoogleDirectoryConfig, scope: 'readonly' | 'readwrite') { ... }
export async function listWorkspaceUsers(config: GoogleDirectoryConfig): Promise<GoogleUser[]> { /* paginated fetch from plan 002 */ }
export async function getWorkspaceUserByEmail(config: GoogleDirectoryConfig, email: string): Promise<GoogleUser | null> { ... }
export async function updateUserGitHubUsername(config: GoogleDirectoryConfig, email: string, githubUsername: string): Promise<void> { ... }
```

Move the bodies from the BFF implementation (it's the superset), carrying plan 002's pagination loop verbatim. Errors: throw — no `console.error` in shared (callers decide); keep `getWorkspaceUserByEmail` returning `null` on fetch error to preserve current BFF 404 behavior (this is current behavior in `getWorkspaceUser` — preserve it, note it).

Add `googleapis` to `packages/shared/package.json` dependencies; export the module per the existing exports-map pattern; `bun install`.

**Verify**: `cd packages/shared && bunx tsc --noEmit` → exit 0.

### Step 2: Shared GitHub org-membership module

Create `packages/shared/src/services/github-org.ts`:

```ts
export type GitHubOrgConfig = { token: string; orgName: string };

export async function getMemberUsernames(config: GitHubOrgConfig): Promise<Set<string>>;
export async function getInvitedUsernames(config: GitHubOrgConfig): Promise<Set<string>>;
export async function inviteUserToOrg(config: GitHubOrgConfig, username: string): Promise<void>;
export async function removeOrgMember(config: GitHubOrgConfig, username: string): Promise<void>;
```

Bodies from `packages/worker/src/services/github.ts` (it's the superset), minus the Effect wrapping. Reuse a per-config memoized Octokit or construct per call — match current behavior (each current service holds one Octokit; a module-level `new Octokit` per function call is a behavior change in rate-limit accounting — prefer a small `createOrgClient(config)` returning an object holding one Octokit with the four methods; both wrappers then hold one instance, matching today).

Add `octokit` to shared deps.

**Verify**: `cd packages/shared && bunx tsc --noEmit` → exit 0.

### Step 3: Rewire the BFF wrappers

`packages/bff/src/services/google-workspace.ts` becomes a thin adapter: builds `GoogleDirectoryConfig` from `envVars`, re-exports `GoogleUser`, and keeps the **same exported function signatures** used by routes (`createGoogleAuth`, `getWorkspaceUsers(auth)`, `getWorkspaceUser(auth, email)`, `updateUserCustomSchema(email, username)`) so `routes/users.ts` doesn't change — `createGoogleAuth` can degrade to returning the config object; the `auth` parameter of the two getters becomes that config (typed accordingly). Keep the `console.error` logging here at the BFF layer. Same approach for `github-membership.ts`: the class remains, methods delegate to the shared client.

**Verify**: `cd packages/bff && bunx tsc --noEmit` → exit 0; `bun test packages/bff` → all pass (plan 008's route tests unchanged and green — they mock these wrapper modules, which still exist).

### Step 4: Rewire the worker layers

`packages/worker/src/services/google-workspace.ts`: `GoogleWorkspaceServiceLive`'s `getUsers` body becomes `Effect.tryPromise({ try: () => listWorkspaceUsers(config), catch: ... })` with the same `GoogleWorkspaceError` mapping; re-export `GoogleUser` from shared so the atlassian imports keep resolving. `packages/worker/src/services/github.ts`: same treatment for the four methods (`getUserId` can stay local if shared doesn't need it — keep it wherever the diff is smaller).

Update plan 002's google-workspace tests: their `mock.module('googleapis', ...)` target still works if the shared module imports `googleapis` — but the mock must now be registered against the *shared* module's import. With Bun, `mock.module('googleapis', ...)` is global to the test process, so it should keep intercepting; verify, and if not, point the tests at the shared functions directly (they're now plain functions — simpler to test without any module mock by mocking `googleapis` only).

**Verify**: `bun test --recursive` → all pass, test count unchanged from before the refactor. `grep -rn "directory.users.list" packages/bff/src packages/worker/src` → no matches.

## Test plan

No new tests required; the gate is the **unchanged** existing suite (sync-engine, route tests, google-workspace pagination tests, atlassian characterization tests if plan 007 landed). Record before/after test counts in your report — they must match.

## Done criteria

- [ ] `directory.users.list` and `orgs.listMembers` appear only under `packages/shared/src/`
- [ ] `GoogleUser` is defined once (in shared) — `grep -rn "export type GoogleUser" packages/*/src` → 1 definition + re-exports only
- [ ] Consumer files (`routes/*.ts`, `sync-engine.ts`, `job-processor.ts`, `index.ts` of both packages) have **zero diff** (`git diff --stat` confirms)
- [ ] `bun run typecheck` exits 0; `bun test --recursive` exits 0 with the same test count as pre-refactor; `bun run lint` exits 0
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 002 is not DONE (check `plans/README.md` and the live code for the pagination loop) — executing this first re-spreads the truncation bug.
- Keeping the BFF wrapper signatures stable turns out to require changing `routes/users.ts` anyway — stop; the consumer-zero-diff property is the plan's safety argument.
- Bun's `mock.module` interception doesn't reach the shared package's imports and the plan-002 tests can't be adapted within two attempts.
- Shared gains a transitive dependency conflict (googleapis/octokit version skew across packages) — report, don't force-resolve.

## Maintenance notes

- After this, an API-behavior change (new scope, new pagination size, normalization tweak) is a one-file edit in shared. CLAUDE.md's monorepo section should eventually mention `packages/shared/src/services/`.
- The Effect error-mapping layer in the worker is intentionally thin — resist moving Effect into shared (the BFF doesn't use Effect; shared staying plain-async is what makes it shareable).
- Reviewer: the whole diff should be code *moving*, not changing — scrutinize any line that isn't a move, especially error handling and the Octokit instance lifecycle.
