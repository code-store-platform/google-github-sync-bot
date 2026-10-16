# Plan 010: Rewrite the stale README and add `.env.example`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 635fc3c..HEAD -- README.md packages/bff/src/lib/config.ts packages/worker/src/lib/config.ts`
> Plans 006 may have added env vars to the config schemas — that's expected
> drift: include the *live* schemas' variables in `.env.example`, not the
> planning-time list. STOP only if README.md itself was already rewritten.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW (docs only)
- **Depends on**: none (but if plan 006 landed, include its new env vars)
- **Category**: docs / dx
- **Planned at**: commit `635fc3c`, 2026-06-11

## Why this matters

The README still documents the **previous generation** of this tool: a single-process app started with `bun run index.ts`, a Slack bot with a `/sync-github` slash command, and env vars (`SLACK_SIGNING_SECRET`, `SLACK_APP_TOKEN`) that no code reads anymore. The repo is now a four-package monorepo (BFF + worker + web + shared) — accurately described in `CLAUDE.md` but contradicted by the README a new contributor reads first. There is also no `.env.example`, so the only way to learn the ~20 required/optional env vars is to read two Zod schemas.

**Hard rule: never copy any value from the existing root `.env` file. Do not open it. All example values are placeholders.**

## Current state

- `README.md` — 61 lines; stale claims to remove: "Provides a Slack bot with commands" (line 9), `SLACK_SIGNING_SECRET`/`SLACK_APP_TOKEN` in the config block (lines 32–33), "Slack workspace with a bot app installed" (line 44), `bun run index.ts` usage (line 50), single-container docker run (lines 53–57), "Slack Commands /sync-github" section (lines 59–61). `index.ts` no longer exists at the repo root.
- `CLAUDE.md` — accurate, detailed: monorepo layout, dev commands, BFF/worker split, sync job flow, full env-var reference. Use it as the source of truth; the README should be the shorter public-facing version, not a copy.
- Env schemas (the authoritative variable lists — read both live files):
  - `packages/bff/src/lib/config.ts` — `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_ADMIN_EMAIL`, `GITHUB_TOKEN`, `GITHUB_ORG_NAME`, `API_PORT` (default 4000), `CORS_ORIGIN` (default http://localhost:3001), `DATABASE_URL` (default postgres://postgres:postgres@localhost:5432/dashboard).
  - `packages/worker/src/lib/config.ts` — `DATABASE_URL`, the four Google/GitHub vars, `CRON_SCHEDULE` (default `0 0 0 * * *`), `REMOVE_STOP_LIST` (optional CSV), `SLACK_BOT_TOKEN` + `SLACK_NOTIFICATION_CHANNEL` (optional), `ATLASSIAN_ENABLED` flag with `ATLASSIAN_API_KEY`/`ATLASSIAN_ORG_ID`/`ATLASSIAN_ADMIN_EMAIL` required when enabled, `ATLASSIAN_SUSPEND_STOP_LIST` (optional CSV), `ATLASSIAN_DRY_RUN`, `ATLASSIAN_INACTIVITY_CRON_SCHEDULE` (default `0 0 0 * * *`).
  - Web: `NEXT_PUBLIC_API_URL` (read in `packages/web/src/lib/api-client.ts:17`) — unless plan 006 landed, in which case it's `BFF_INTERNAL_URL`, `API_AUTH_TOKEN`, `DASHBOARD_USER`/`DASHBOARD_PASSWORD`; check the live code.
- `.gitignore` ignores `.env` but not `.env.example` — safe to commit.
- Dev commands (verified): `bun install`, `docker compose up -d`, `bun run db:push`, `bun run dev` (all three processes) or `dev:bff` / `dev:worker` / `dev:web`, `bun test --recursive`, `bun run lint`, `bun run format` (+ `bun run typecheck` once plan 001 lands).
- Existing docs to link: `docs/decisions/001-bff-worker-split.md` (ADR explaining the architecture).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Confirm no real secrets committed | `git diff --cached` review before commit | placeholders only |
| Lint (biome also checks md? no — skip) | `bun run lint` | exit 0 |
| Verify .env.example completeness | `grep -oE '^\s+[A-Z_]+:' packages/bff/src/lib/config.ts packages/worker/src/lib/config.ts` | every var appears in `.env.example` |

## Scope

**In scope**:
- `README.md` (rewrite)
- `.env.example` (create, repo root)

**Out of scope** (do NOT touch):
- `CLAUDE.md` — already accurate.
- `docs/architecture-plan.md` — uncommitted scratch file owned by the operator; leave it alone.
- The root `.env` — never read it, never reference its contents.
- Any code.

## Git workflow

- Branch: `advisor/010-readme-and-env-example`
- Commit style: imperative summary, e.g. `Rewrite README for monorepo architecture and add .env.example`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Create `.env.example`

One entry per variable from the **live** config schemas, grouped with comments, placeholders only. Shape:

```dotenv
# ── Google Workspace (BFF + worker) ─────────────────────────────
# Service-account JSON (single line) with domain-wide delegation,
# scope: admin.directory.user
GOOGLE_APPLICATION_CREDENTIALS='{"type":"service_account","project_id":"...","private_key":"...","client_email":"..."}'
GOOGLE_ADMIN_EMAIL=admin@example.com

# ── GitHub (BFF + worker) ───────────────────────────────────────
# Personal access token with org admin permissions
GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx
GITHUB_ORG_NAME=your-org

# ── Database ────────────────────────────────────────────────────
DATABASE_URL=postgres://postgres:postgres@localhost:5432/dashboard
...
```

Cover every variable; mark optional ones with a comment (`# optional:`) and show defaults as the value where a default exists. Include the Atlassian block commented out with a note that the three credentials become required when `ATLASSIAN_ENABLED=true`.

**Verify**: for every key in both Zod schemas (`grep -oE '^\s+[A-Z_0-9]+:' packages/*/src/lib/config.ts | grep -oE '[A-Z_0-9]+'`), `grep "<KEY>" .env.example` matches. No real-looking secret values (`grep -cE '(ghp_[A-Za-z0-9]{30,}|BEGIN PRIVATE KEY)' .env.example` → 0... placeholders must be obviously fake).

### Step 2: Rewrite `README.md`

Target structure (~80–120 lines):

1. **Title + one-paragraph description** — sync Google Workspace ↔ GitHub org membership; admin dashboard; Slack *notifications* (explicitly not a bot); optional Atlassian license cleanup behind a feature flag.
2. **Architecture** — a short list of the three processes + shared package (BFF :4000, worker, web :3001, PostgreSQL), one sentence on the job-queue flow (BFF enqueues into `sync_jobs`, worker processes, dashboard polls), link to `docs/decisions/001-bff-worker-split.md` and `CLAUDE.md` for depth.
3. **Quick start** — prerequisites (Bun, Docker); then exactly: `bun install` → `cp .env.example .env` (fill in) → `docker compose up -d` → `bun run db:push` → `bun run dev` → open http://localhost:3001.
4. **Configuration** — point to `.env.example`; table or list of the *required* vars only; mention Atlassian flag + dry-run; mention `REMOVE_STOP_LIST` safety valve.
5. **Development** — `bun run dev:*`, `bun test --recursive`, `bun run lint`, `bun run format`, `bun run db:studio` (+ `bun run typecheck` if it exists by then).
6. **How a sync works** — 5 bullet lifecycle (fetch workspace users → diff against org members/invites → invite/remove respecting stop list → record history → Slack notification).
7. **Deployment** — Dockerfile exists; keep this section honest and minimal: verify what `Dockerfile` actually builds (read it) and describe only that; if it still targets the old single-process app, say "Dockerfile predates the monorepo split" and flag it instead of documenting fiction.

Remove every stale claim listed in Current state.

**Verify**: `grep -nE "sync-github|SLACK_SIGNING_SECRET|SLACK_APP_TOKEN|bun run index.ts" README.md` → no matches.

## Test plan

Docs only. The verification greps in Steps 1–2 are the gates, plus a read-through: every command in the README quick start must be runnable verbatim from a fresh clone (run them if a local Docker is available; note in the report if you couldn't).

## Done criteria

- [ ] `.env.example` exists at repo root, contains every var from both config schemas, placeholders only
- [ ] `git check-ignore .env.example` → NOT ignored (exit 1)
- [ ] README has no references to the Slack bot/commands, removed env vars, or `bun run index.ts`
- [ ] README quick-start commands match `package.json` scripts exactly
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- README.md at HEAD differs substantially from the 61-line stale version described (someone already rewrote it).
- You realize you need to open `.env` to figure out a variable's format — don't; derive format from the Zod schema and code usage, or use an obviously fake placeholder.

## Maintenance notes

- Whenever a config schema gains a variable, `.env.example` must gain it too — worth a line in CLAUDE.md's instructions.
- The Dockerfile/dokku deployment story was intentionally only *described*, not fixed; if the Dockerfile is stale (single-process), that's a separate small plan.
- Reviewer: diff the `.env.example` keys against both Zod schemas one more time.
