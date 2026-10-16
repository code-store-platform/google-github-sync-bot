# Plan 001: Make `tsc --noEmit` pass and enforce lint + typecheck + tests in CI

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 635fc3c..HEAD -- package.json packages/shared/tsconfig.json packages/bff/tsconfig.json packages/worker/tsconfig.json .github/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: dx
- **Planned at**: commit `635fc3c`, 2026-06-11

## Why this matters

This repo has no CI and no typecheck script — `tsc --noEmit` is never run anywhere, and it currently **fails** in 3 of 4 packages because the per-package tsconfigs don't load Bun's type declarations. Every other plan in `plans/` uses "typecheck passes" and "tests pass in CI" as verification gates, so this plan is the prerequisite for all of them. After it lands, one command (`bun run typecheck`) proves type soundness, and GitHub Actions blocks regressions on every push.

## Current state

- Runtime is **Bun** (not Node). Monorepo with Bun workspaces: `packages/shared`, `packages/bff`, `packages/worker`, `packages/web`.
- Root `package.json` scripts (lines 6–18): has `format`, `lint` (`biome lint`), `test` (`bun test --recursive`), dev scripts — **no `typecheck`**.
- Root devDependencies include `"@types/bun": "latest"` and peerDependency `"typescript": "^6.0.3"` (tsc 6.0.3 resolves via `bunx tsc`).
- There is **no `.github/` directory** — no CI at all.
- `tsconfig.base.json` sets `"noEmit": true`, `"strict": true`. It does NOT set a `types` array, so `tsc` can't find `bun:test` / the `Bun` global.

Current per-package tsconfigs:

`packages/shared/tsconfig.json` (entire file):
```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"]
}
```

`packages/bff/tsconfig.json` (entire file):
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "plugins": [
      {
        "name": "@effect/language-service"
      }
    ]
  },
  "include": ["src/**/*.ts"]
}
```

`packages/worker/tsconfig.json` is like bff's but additionally has `"jsx": "react-jsx"` in compilerOptions.

Current typecheck failures (verified on 2026-06-11, the complete list):

- `packages/shared`: `src/utils.test.ts(1,40): error TS2307: Cannot find module 'bun:test'`
- `packages/bff`: `src/index.ts(23,1): error TS2868: Cannot find name 'Bun'` plus two `bun:test` TS2307 errors in `src/services/github-{repos,teams}.test.ts`
- `packages/worker`: two `bun:test` TS2307 errors (slack-formatter.test.ts, sync-engine.test.ts). The `TS47` lines about `Effect.void` are informational messages from the Effect language-service plugin, **not errors** — ignore them.
- `packages/web`: passes already (Next.js tsconfig handles its own types). Do not touch it except to call its typecheck.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `bun install` | exit 0 |
| Typecheck one package | `cd packages/<p> && bunx tsc --noEmit` | exit 0, no `error TS` lines |
| Tests | `bun test --recursive` | `40 pass, 0 fail` (count may have grown if other plans landed first) |
| Lint | `bun run lint` | exit 0 (warnings are OK; errors are not) |

## Scope

**In scope** (the only files you should modify/create):
- `packages/shared/tsconfig.json`
- `packages/bff/tsconfig.json`
- `packages/worker/tsconfig.json`
- `package.json` (root — add scripts only)
- `packages/web/package.json` (add a `typecheck` script only)
- `.github/workflows/ci.yml` (create)

**Out of scope** (do NOT touch):
- `tsconfig.base.json` — shared by all packages including web; adding `"types": ["bun"]` there would force Bun types onto the Next.js package. Change the three package tsconfigs instead.
- Any `src/` file. If typecheck still fails after the tsconfig fix, that's a STOP condition, not an invitation to edit source.
- `biome.json`, existing lint warnings — leave them.

## Git workflow

- Branch from the current branch: `advisor/001-typecheck-and-ci`
- Commit style (match `git log`): imperative summary, e.g. `Add typecheck script and CI workflow: fix bun types in package tsconfigs`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add Bun types to the three failing package tsconfigs

In each of `packages/shared/tsconfig.json`, `packages/bff/tsconfig.json`, `packages/worker/tsconfig.json`, add `"types": ["bun"]` to `compilerOptions` (create the `compilerOptions` object in shared's tsconfig, which doesn't have one). Example for shared:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["bun"]
  },
  "include": ["src/**/*.ts"]
}
```

For bff and worker, add the `"types": ["bun"]` key alongside the existing `plugins` (and `jsx` in worker). Preserve everything already there.

**Verify**: `for p in shared bff worker web; do (cd packages/$p && bunx tsc --noEmit) || echo "FAILED: $p"; done` → no `FAILED:` lines, no `error TS` lines (informational `message TS47` lines from the Effect plugin are fine).

### Step 2: Add typecheck scripts

In root `package.json`, add to `scripts`:

```json
"typecheck": "bun run --filter '*' typecheck"
```

Then add `"typecheck": "tsc --noEmit"` to the `scripts` of all four package manifests: `packages/shared/package.json`, `packages/bff/package.json`, `packages/worker/package.json`, `packages/web/package.json`. (If `bun run --filter '*' typecheck` errors on your Bun version, fall back to a plain chained script: `"typecheck": "tsc --noEmit -p packages/shared && tsc --noEmit -p packages/bff && tsc --noEmit -p packages/worker && tsc --noEmit -p packages/web"` — verify whichever variant you use actually runs all four.)

**Verify**: `bun run typecheck` → exit 0, output shows all four packages checked.

### Step 3: Create the CI workflow

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  ci:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest
      - run: bun install --frozen-lockfile
      - run: bun run lint
      - run: bun run typecheck
      - run: bun test --recursive
```

Note: the test suite does not require PostgreSQL (all 40 current tests use mocks/layers) — do not add a postgres service container.

**Verify**: locally simulate the pipeline: `bun install --frozen-lockfile && bun run lint && bun run typecheck && bun test --recursive` → all exit 0, tests all pass.

## Test plan

No new tests — this plan adds verification infrastructure. The gate is that the existing suite (40 tests / 5 files) still passes and typecheck now passes everywhere.

## Done criteria

- [ ] `bun run typecheck` exits 0 and covers all four packages
- [ ] `bun test --recursive` exits 0
- [ ] `bun run lint` exits 0
- [ ] `.github/workflows/ci.yml` exists and runs lint, typecheck, test
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- After Step 1, any package still has `error TS` output — the fix would then require source edits, which are out of scope.
- `bun install` modifies `bun.lock` (lockfile drift means the environment differs from the planned state).
- The tsconfig files don't match the excerpts above.

## Maintenance notes

- Plans 002–012 all use `bun run typecheck` as a gate; if you rename the script, update them.
- When the web package's Next.js version changes, its own tsconfig may regenerate — CI will catch type breaks from now on.
- Deferred deliberately: pre-commit hooks (husky/lefthook). CI is the enforcement point; add hooks later only if the team wants faster local feedback.
