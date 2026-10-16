# Google-GitHub Sync

Synchronizes Google Workspace users with GitHub organization membership and provides an administrative dashboard for users, teams, repositories and sync history. Slack notifications and optional Atlassian synchronization run in the worker.

## Setup

Use the Bun version pinned in `package.json`, then install dependencies and create your configuration:

```sh
bun install
cp .env.example .env
```

Fill in `.env` before running the following commands. You need a Google service account with domain-wide delegation, a delegated admin email, and a GitHub token with the organization permissions required by the operations you use. GitHub usernames are read from the Google custom schema `3rd-party_tools.GitHub_Username`.

```sh
docker compose up -d
bun run db:push
bun run dev
```

The dashboard runs on port 3001, the BFF API on port 4000, and the worker processes scheduled and dashboard-triggered jobs. Each development command loads the root `.env`.

## Authentication and deployment

Set three server-side variables:

- `DASHBOARD_USERNAME`: the dashboard Basic Auth username, without a colon.
- `DASHBOARD_PASSWORD`: a distinct password of at least 16 characters.
- `API_AUTH_TOKEN`: a random token of at least 32 characters, shared by the web server and BFF. Generate it with `openssl rand -hex 32`.

The browser prompts for the dashboard username and password. All dashboard API requests use the same origin and pass through a Next.js route that checks authentication again and attaches the BFF token on the server. The BFF independently requires that token; only `GET /health` is public. Missing authentication settings fail closed. Never put credentials in `NEXT_PUBLIC_*` variables.

`BFF_URL` is the server-side address of the BFF, defaulting to `http://localhost:4000`. `NEXT_PUBLIC_API_URL` is no longer used. Set `CORS_ORIGIN` to the dashboard's exact external origin, including scheme and port, so authenticated browser writes pass the origin check. Use HTTPS outside localhost and keep port 4000 on a private network. If web and BFF run separately, supply the same `API_AUTH_TOKEN` to both; only web needs the dashboard credentials. Basic Auth is a shared administrator account, not per-user SSO.

## Sync behavior

Both the dashboard and worker fetch every Google Workspace user page. A page failure or repeated pagination token rejects the complete snapshot, so a partial directory cannot trigger removals. Users absent from the complete directory are removed from GitHub unless their username appears in the comma-separated `REMOVE_STOP_LIST`.

Internal GitHub repositories and custom repository roles are displayed. The dashboard's write controls retain the supported public/private visibility and built-in permission values; it does not change an internal repository's visibility when editing unrelated settings.

## Checks

```sh
bun test --recursive
bun run typecheck
bun run lint
bun run --cwd packages/web build
bun audit
```

Root dependency overrides pin patched transitive versions reported by the audit. The `esbuild` override also covers Drizzle's legacy loader; verify Drizzle configuration loading when updating it. Reassess overrides as upstream dependencies adopt patched versions.

Queue concurrency tests use real PostgreSQL and are skipped unless `TEST_DATABASE_URL` is set. Point it at a disposable test database; the suite creates and removes a uniquely named schema:

```sh
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/sync_test bun test packages/worker/src/services/sync-job-repo.test.ts
```

The worker polls every five seconds. Each claim atomically locks a pending row and changes it to `running`, preventing multiple workers from claiming the same job.
