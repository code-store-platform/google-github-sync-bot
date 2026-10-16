# Plan 006: Require authentication for the BFF API and the dashboard

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 635fc3c..HEAD -- packages/bff/src/index.ts packages/bff/src/lib/config.ts packages/bff/src/middleware/ packages/web/src/lib/api-client.ts packages/web/next.config.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1 (most severe finding in the audit)
- **Effort**: M
- **Risk**: MED (touches every API call path; a config mistake locks the dashboard out — recoverable by env fix)
- **Depends on**: plans/001-typecheck-and-ci.md; plans/005-error-handler-hardening.md (401s flow through the error handler)
- **Category**: security
- **Planned at**: commit `635fc3c`, 2026-06-11

## Why this matters

The BFF API has **zero authentication**. Anyone who can reach port 4000 can rename GitHub usernames stored in Google Workspace, add/remove GitHub org members and teams, change repo access, and trigger syncs. The Next.js dashboard on port 3001 is equally open. The repo ships a `Dockerfile` and has a `dokku` git remote, so this is deployed to a real server, not just localhost. This plan adds two layers: (1) the BFF requires a bearer token on every `/api/*` route; (2) the dashboard (and its server-side proxy, which is the only holder of that token) sits behind HTTP Basic Auth. After this, the browser never sees the BFF token, and both ports require credentials.

This is deliberately a **shared-secret MVP** — appropriate for a small internal admin tool. Per-user SSO (Google OIDC) and actor attribution in the audit log are explicitly deferred (see Maintenance notes).

## Current state

- `packages/bff/src/index.ts` (lines 11–21) — app setup; only CORS middleware, no auth:

```ts
const api = new Hono();

api.use('*', corsMiddleware);
api.onError(errorHandler);

api.get('/health', (c) => c.json({ status: 'ok' }));
api.route('/api/users', userRoutes);
// ... teams, repos, sync, activity
```

- `packages/bff/src/lib/config.ts` — Zod env schema: `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_ADMIN_EMAIL`, `GITHUB_TOKEN`, `GITHUB_ORG_NAME`, `API_PORT` (default 4000), `CORS_ORIGIN` (default `http://localhost:3001`), `DATABASE_URL`. No auth-related vars.
- `packages/bff/src/middleware/cors.ts` — already allows the `Authorization` header (`allowHeaders: ['Content-Type', 'Authorization']`). No change needed.
- `packages/web/src/lib/api-client.ts` (line 17) — browser calls the BFF directly:

```ts
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
```

All API functions go through `fetchApi<T>(path, init)` in the same file.
- `packages/web/src/app/` — Next.js 15 App Router. Data fetching is client-side via TanStack Query; there is no existing `middleware.ts` and no `src/app/api/` directory.
- The `.env` file lives at the repo root and is loaded by each package's dev script (`bun run --env-file ../../.env`). **Never copy values from the existing `.env` into any file or output.**
- Error responses: after plan 005, throw `HTTPException` for client-visible errors (pattern: `packages/bff/src/routes/users.ts:73`).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `bun run typecheck` | exit 0 |
| Tests | `bun test --recursive` | all pass |
| Lint | `bun run lint` | exit 0 |
| Generate secrets | `openssl rand -hex 32` | a random hex string |
| Manual BFF check | `curl -s -o /dev/null -w '%{http_code}' localhost:4000/api/users` | `401` without header |

## Scope

**In scope** (the only files you should modify/create):
- `packages/bff/src/lib/config.ts`
- `packages/bff/src/middleware/auth.ts` (create)
- `packages/bff/src/middleware/auth.test.ts` (create)
- `packages/bff/src/index.ts`
- `packages/web/src/app/api/bff/[...path]/route.ts` (create)
- `packages/web/src/middleware.ts` (create — note: in `src/`, sibling of `app/`)
- `packages/web/src/lib/api-client.ts`
- `.env` (append three new keys locally — values you generate, never echoed into committed files)

**Out of scope** (do NOT touch):
- Route files in `packages/bff/src/routes/` — auth is middleware-level.
- The worker package — it talks to Postgres and external APIs, not to the BFF.
- Audit-log actor attribution (schema change) — deferred.
- OAuth/OIDC, sessions, login pages — deferred; Basic Auth is the chosen MVP.

## Git workflow

- Branch: `advisor/006-bff-authentication`
- Commit per step; message style: imperative summary, e.g. `Add bearer-token auth to BFF API`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the token to BFF config

In `packages/bff/src/lib/config.ts`, add to the Zod object:

```ts
API_AUTH_TOKEN: z.string().min(16),
```

No default — the BFF must refuse to start without it (Zod `.parse` already throws on missing keys). Append to the root `.env` a locally generated value: `API_AUTH_TOKEN=<output of openssl rand -hex 32>`.

**Verify**: `cd packages/bff && bunx tsc --noEmit` → exit 0.

### Step 2: Bearer-token middleware

Create `packages/bff/src/middleware/auth.ts`:

```ts
import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { envVars } from '../lib/config';

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const header = c.req.header('Authorization');
  if (header !== `Bearer ${envVars.API_AUTH_TOKEN}`) {
    throw new HTTPException(401, { message: 'Unauthorized' });
  }
  await next();
};
```

In `packages/bff/src/index.ts`, register it on API routes only, after CORS, before the route mounts:

```ts
api.use('*', corsMiddleware);
api.use('/api/*', authMiddleware);
api.onError(errorHandler);
```

`/health` stays open (used for liveness checks).

**Verify**: `cd packages/bff && bunx tsc --noEmit` → exit 0.

### Step 3: Middleware tests

Create `packages/bff/src/middleware/auth.test.ts`. Mock config first (pattern from `packages/bff/src/services/github-teams.test.ts`):

```ts
import { describe, expect, test, mock } from 'bun:test';

mock.module('../lib/config', () => ({ envVars: { API_AUTH_TOKEN: 'test-token-1234567890' } }));

const { authMiddleware } = await import('./auth');
```

Build a tiny Hono app: `app.use('/api/*', authMiddleware); app.get('/api/ping', c => c.json({ ok: true })); app.get('/health', c => c.json({ status: 'ok' }))`, register the real `errorHandler`. Cases:
1. No `Authorization` header → 401.
2. Wrong token (`Bearer nope`) → 401.
3. Correct token → 200 `{ ok: true }`.
4. `/health` without header → 200.

**Verify**: `bun test packages/bff/src/middleware/auth.test.ts` → 4 pass.

### Step 4: Next.js server-side proxy (keeps the token out of the browser)

Create `packages/web/src/app/api/bff/[...path]/route.ts`:

```ts
const BFF_URL = process.env.BFF_INTERNAL_URL || 'http://localhost:4000';
const TOKEN = process.env.API_AUTH_TOKEN || '';

async function proxy(req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const url = new URL(req.url);
  const target = `${BFF_URL}/api/${path.join('/')}${url.search}`;

  const res = await fetch(target, {
    method: req.method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    },
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.text(),
  });

  return new Response(await res.text(), {
    status: res.status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export { proxy as GET, proxy as POST, proxy as PATCH, proxy as PUT, proxy as DELETE };
```

(Next.js 15: route-handler `params` is a Promise — keep the `await params`.) Append to the root `.env`: `BFF_INTERNAL_URL=http://localhost:4000` (and note that `API_AUTH_TOKEN` from Step 1 is read here too — same root `.env`, loaded by `next dev` only if the web dev script uses `--env-file`; check `packages/web/package.json` and mirror the bff/worker `--env-file ../../.env` approach if it doesn't).

In `packages/web/src/lib/api-client.ts`, change line 17 to route through the proxy:

```ts
const API_URL = '/api/bff';
```

(`NEXT_PUBLIC_API_URL` becomes unused; remove the reference.) All call sites already prefix paths with `/api/...` — they must now NOT double the prefix: the existing paths are like `/api/users`, so set `API_URL = '/api/bff'` and strip the leading `/api` in `fetchApi`, OR simpler: keep call sites untouched and make `fetchApi` rewrite: `fetch(`${API_URL}${path.replace(/^\/api/, '')}`)`. Choose the simpler rewrite in `fetchApi`; do not edit 30 call sites.

**Verify**: `cd packages/web && bunx tsc --noEmit` → exit 0.

### Step 5: Basic Auth in front of the dashboard

Create `packages/web/src/middleware.ts`:

```ts
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  const expectedUser = process.env.DASHBOARD_USER || 'admin';
  const expectedPass = process.env.DASHBOARD_PASSWORD;
  if (!expectedPass) {
    return new NextResponse('DASHBOARD_PASSWORD not configured', { status: 503 });
  }

  const header = req.headers.get('authorization') || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    const [user, pass] = atob(encoded).split(':');
    if (user === expectedUser && pass === expectedPass) return NextResponse.next();
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="dashboard"' },
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

The matcher covers pages **and** `/api/bff/*` — the proxy must be behind the same gate, otherwise it's an unauthenticated relay to the BFF. Append `DASHBOARD_PASSWORD=<openssl rand -hex 16>` (and optionally `DASHBOARD_USER`) to the root `.env`.

**Verify**: `cd packages/web && bunx tsc --noEmit` → exit 0.

### Step 6: End-to-end manual verification

Start Postgres + all three processes (`docker compose up -d && bun run dev`). Then:

1. `curl -s -o /dev/null -w '%{http_code}\n' localhost:4000/api/users` → `401`
2. `curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $API_AUTH_TOKEN" localhost:4000/api/users` (export the value from `.env` into your shell first) → `200`
3. `curl -s -o /dev/null -w '%{http_code}\n' localhost:3001/users` → `401`
4. `curl -s -o /dev/null -w '%{http_code}\n' localhost:3001/api/bff/users` → `401` (proxy gated)
5. `curl -s -o /dev/null -w '%{http_code}\n' -u "admin:$DASHBOARD_PASSWORD" localhost:3001/api/bff/users` → `200`
6. Open `http://localhost:3001` in a browser, enter the Basic Auth credentials → user list loads (proves the proxy + token chain works).

**Verify**: all six checks return the stated codes. If Google/GitHub credentials in your environment are invalid, checks 2/5/6 may return 500 from upstream APIs — a 500 here still proves auth passed (the request reached the route); note that in your report.

## Test plan

- 4 middleware tests (Step 3), modeled on `github-teams.test.ts` mocking style.
- Manual end-to-end matrix (Step 6) — record the six status codes in your report.
- Full gate: `bun test --recursive` → all pass.

## Done criteria

- [ ] `grep -n "authMiddleware" packages/bff/src/index.ts` → registered on `/api/*`
- [ ] `grep -rn "NEXT_PUBLIC_API_URL" packages/web/src` → no match
- [ ] `packages/web/src/middleware.ts` exists and gates `/api/bff` (matcher excludes only static assets)
- [ ] `bun run typecheck` exits 0; `bun test --recursive` exits 0 with 4 new tests
- [ ] Manual matrix from Step 6 recorded (or explicitly noted as blocked by missing local credentials)
- [ ] No secret values appear in any committed file (`git diff` reviewed; `.env` is gitignored)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Any dashboard data fetching turns out to run **server-side** (a server component calling `api.*`) — `grep -rn "from '@/lib/api-client'" packages/web/src/app` and check those files for missing `'use client'`; relative `/api/bff` URLs break on the server, and the fix needs a decision (absolute internal URL vs. per-environment base).
- The deployed environment (dokku) turns out to terminate TLS elsewhere or strip `Authorization` headers — Basic Auth over plain HTTP is not acceptable; report instead of shipping.
- Next.js middleware doesn't intercept the route handler in the installed Next version (verify check 4 actually returns 401 — if it returns 200, STOP).
- You're tempted to add a login page, session cookies, or OAuth — out of scope.

## Maintenance notes

- **Deferred, in order of value**: (1) Google OIDC for per-user login (the org already lives in Google Workspace), which unlocks (2) actor attribution — add a `performed_by` column to `audit_log` and populate it from the session; today every audit row is anonymous "dashboard". (3) Rate limiting on `/api/sync`.
- Deployment: dokku must set `API_AUTH_TOKEN`, `DASHBOARD_PASSWORD`, `BFF_INTERNAL_URL` (BFF reachable from the web container, ideally on an internal network with port 4000 not publicly exposed at all). Rotate the token by changing it in both processes' env simultaneously.
- Reviewer: confirm `/health` is the only unauthenticated BFF route, and that the web middleware matcher doesn't accidentally exclude `/api`.
