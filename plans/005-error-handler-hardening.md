# Plan 005: Stop leaking internal error details from the BFF error handler

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 635fc3c..HEAD -- packages/bff/src/middleware/error-handler.ts`
> If the file changed since this plan was written, compare the "Current
> state" excerpt against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/001-typecheck-and-ci.md
- **Category**: security
- **Planned at**: commit `635fc3c`, 2026-06-11

## Why this matters

The BFF's global error handler returns `err.message` verbatim for **every** error. Unexpected failures bubble up from Drizzle/postgres, Octokit, and the Google Admin SDK — their messages can contain connection strings, internal hostnames, API URLs, and SDK internals, all of which currently land in the JSON response of an API that (until plan 006 lands) is reachable without authentication. Intentional errors thrown as Hono `HTTPException` (404 "User not found", 400 "githubUsername is required") are user-facing by design and must keep their messages.

## Current state

- `packages/bff/src/middleware/error-handler.ts` — the entire file today:

```ts
import type { ErrorHandler } from 'hono';

export const errorHandler: ErrorHandler = (err, c) => {
  console.error('Unhandled API error:', err);

  const status = 'status' in err && typeof err.status === 'number' ? err.status : 500;
  const message = err.message || 'Internal Server Error';

  return c.json({ error: message, code: status }, status as 400);
};
```

- It is registered once in `packages/bff/src/index.ts:14` via `api.onError(errorHandler)`.
- Routes throw `HTTPException` from `hono/http-exception` for intentional errors — e.g. `packages/bff/src/routes/users.ts:73`: `throw new HTTPException(404, { message: 'User not found' })`. These are the safe-to-expose class.
- The web client (`packages/web/src/lib/api-client.ts:28-31`) reads `body.error` for its toast messages — keep the `{ error, code }` response shape.
- Note: the `status as 400` cast is a type workaround only (Hono's `c.json` wants a typed status); it does not affect runtime values. Replacing it with Hono's `ContentfulStatusCode` type is the clean fix.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Typecheck | `bun run typecheck` | exit 0 |
| New tests | `bun test packages/bff/src/middleware/error-handler.test.ts` | all pass |
| Full suite | `bun test --recursive` | all pass |
| Lint | `bun run lint` | exit 0 |

## Scope

**In scope** (the only files you should modify/create):
- `packages/bff/src/middleware/error-handler.ts`
- `packages/bff/src/middleware/error-handler.test.ts` (create)

**Out of scope** (do NOT touch):
- Route files — they already throw `HTTPException` correctly.
- The `{ error, code }` response shape — the web client parses it.
- Adding request IDs / structured logging — worthwhile but separate; note it as follow-up only.

## Git workflow

- Branch: `advisor/005-error-handler-hardening`
- Commit style: imperative summary, e.g. `Harden BFF error handler: generic message for unexpected errors`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Distinguish intentional from unexpected errors

Rewrite `error-handler.ts`:

```ts
import type { ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message, code: err.status }, err.status);
  }

  console.error('Unhandled API error:', err);
  return c.json({ error: 'Internal Server Error', code: 500 }, 500 as ContentfulStatusCode);
};
```

Rules encoded: `HTTPException` → its own status and message (these were authored as user-facing); anything else → logged fully server-side, client gets only `Internal Server Error` / 500. If the `ContentfulStatusCode` import path differs in the installed Hono version (`^4.12.23`), check `node_modules/hono/dist/types/utils/http-status.d.ts` for the correct path; a plain `500` literal typically typechecks without any cast — prefer that if it does.

**Verify**: `cd packages/bff && bunx tsc --noEmit` → exit 0, with no `as 400`-style cast remaining.

### Step 2: Tests

Create `packages/bff/src/middleware/error-handler.test.ts` using `bun:test` and a minimal Hono app (no `mock.module` needed — the handler has no config/db imports):

```ts
import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { errorHandler } from './error-handler';

function appThrowing(err: Error) {
  const app = new Hono();
  app.onError(errorHandler);
  app.get('/boom', () => {
    throw err;
  });
  return app;
}
```

Cases (use `await app.request('/boom')`):
1. `HTTPException(404, { message: 'User not found' })` → status 404, body `{ error: 'User not found', code: 404 }`.
2. `HTTPException(400, { message: 'githubUsername is required' })` → status 400 with that message.
3. `new Error('postgres://user:secret@db:5432 connection refused')` → status 500, body `{ error: 'Internal Server Error', code: 500 }`, and `JSON.stringify(body)` does **not** contain `postgres://` (the leak regression assertion).
4. An object error with a `status` property that is *not* an HTTPException (e.g. an Octokit-style `Object.assign(new Error('API rate limit'), { status: 403 })`) → status 500 with generic message (we deliberately no longer trust arbitrary `status` fields).

**Verify**: `bun test packages/bff/src/middleware/error-handler.test.ts` → 4 pass.

## Test plan

Covered in Step 2 (4 new tests). Full gate: `bun test --recursive` → all pass.

## Done criteria

- [ ] `grep -n "err.message" packages/bff/src/middleware/error-handler.ts` shows it used only inside the `HTTPException` branch
- [ ] `grep -n "as 400" packages/bff/src/middleware/error-handler.ts` → no match
- [ ] `bun run typecheck` exits 0; `bun test --recursive` exits 0 with 4 new tests
- [ ] `bun run lint` exits 0
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The current file doesn't match the excerpt (drift).
- Case 4 reveals route code that depends on non-HTTPException errors carrying their status to the client (search first: `grep -rn "throw" packages/bff/src/routes/` should show only `HTTPException` throws — if it shows something else, report it).

## Maintenance notes

- New routes must throw `HTTPException` for any message meant for the UI; plain `Error`s now surface as generic 500s — worth a line in CLAUDE.md eventually.
- Follow-up deliberately deferred: request-ID correlation between the 500 response and the server log line.
- Reviewer: confirm the web UI's error toasts still show useful text for 404/400 flows (they come from HTTPException messages, unchanged).
