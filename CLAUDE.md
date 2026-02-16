# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Google-GitHub Sync is a tool that synchronizes Google Workspace users with GitHub organization members and Atlassian.
It automatically invites users with GitHub usernames to a GitHub organization and removes users who are no longer in Google Workspace.
It automatically removes users who are no longer in Google Workspace from Atlassian.
It automatically suspends users who are no longer active in Atlassian.
The tool provides a Slack bot interface for manual triggers, scheduled synchronization via cron jobs, and an admin dashboard for visual management.

## Monorepo Structure

```
/
├── packages/
│   ├── server/          # Hono API + Slack bot + Cron (Process 1)
│   │   └── src/
│   │       ├── index.ts           # Hono server + Slack bot + cron jobs
│   │       ├── lib/config.ts      # Centralized config with Zod validation
│   │       ├── lib/utils.ts       # Utility functions
│   │       ├── db/schema.ts       # Drizzle ORM schema (audit_log, sync_history)
│   │       ├── db/index.ts        # Drizzle client
│   │       ├── middleware/         # Hono middleware (CORS, error handler)
│   │       ├── routes/            # API routes (users, sync)
│   │       └── services/          # Business logic (google, github, atlassian, slack)
│   └── web/             # Next.js dashboard (Process 2)
│       └── src/
│           ├── app/               # Next.js App Router pages
│           ├── components/        # React components (layout, users, ui)
│           ├── hooks/             # Custom hooks (use-toast)
│           └── lib/               # API client, types, utils
├── package.json         # Bun workspace root
├── biome.json           # Shared linter/formatter
├── tsconfig.base.json   # Shared TS config
└── docker-compose.yml   # PostgreSQL
```

## Development Commands

**Install dependencies:**
```bash
bun install
```

**Start API server + Slack bot + cron:**
```bash
bun run dev:server
```

**Start Next.js dashboard:**
```bash
bun run dev:web
```

**Database:**
```bash
docker compose up -d          # Start PostgreSQL
bun run db:push               # Push schema to DB
bun run db:studio             # Open Drizzle Studio
```

**Format code:**
```bash
bun run format
```

**Lint code:**
```bash
bun run lint
```

## Architecture

### Server (packages/server)

**Hono API** on port 4000:
- `GET /health` — Health check
- `GET /api/users` — List workspace users with GitHub membership status
- `GET /api/users/:email` — Single user detail
- `PATCH /api/users/:email/github-username` — Update GitHub username in Google Workspace
- `POST /api/sync/github` — Trigger manual GitHub sync
- `GET /api/sync/history` — Query sync history

**Slack Bot** on port 3000 (Socket Mode):
- `/sync-github` — Manual GitHub sync
- `/sync-atlassian` — Manual Atlassian suspension sync
- `/check-atlassian-3m` — Check 3-month inactivity
- `/check-atlassian-6m` — Check 6-month inactivity

**Cron Jobs:**
- GitHub + Atlassian suspension sync (configurable schedule)
- Atlassian inactivity check (configurable schedule)

**Database** (PostgreSQL via Drizzle ORM):
- `audit_log` — Tracks admin actions (e.g., GitHub username changes)
- `sync_history` — Records sync executions with results

### Web Dashboard (packages/web)

**Next.js 15** with App Router on port 3001:
- User directory with search, filter, sort
- User profile with GitHub username editing
- Status badges (member, pending, not linked, not in org)
- Sidebar navigation (Teams and Repos disabled, future phases)

**Tech Stack:**
- TanStack Query for data fetching
- shadcn/ui + Tailwind CSS v4 for styling
- Radix UI primitives

## Key Technical Details

**Google Workspace Integration:**
- Uses service account credentials with domain-wide delegation
- Requires `admin.directory.user` scope (read + write)
- Impersonates admin user via `subject` field
- Fetches up to 300 users with custom schema projection
- GitHub usernames are stored in `customSchemas['3rd-party_tools'].GitHub_Username`

**GitHub Integration:**
- Uses Octokit with personal access token
- Requires organization admin permissions
- Uses pagination for listing members and pending invitations
- Invites users by `invitee_id` (not by email)
- All username comparisons are case-insensitive via `.toLowerCase()`

**Remove Stop List:**
- Environment variable `REMOVE_STOP_LIST` contains comma-separated usernames
- These users will never be removed from GitHub org, even if not in Workspace
- Useful for bot accounts or external collaborators

## Environment Configuration

All configuration is centralized in `packages/server/src/lib/config.ts` which validates environment variables at startup. The `.env` file lives at the monorepo root.

Required environment variables:
- `GOOGLE_APPLICATION_CREDENTIALS`: JSON string of service account credentials
- `GOOGLE_ADMIN_EMAIL`: Admin email to impersonate
- `GITHUB_TOKEN`: GitHub personal access token with org admin permissions
- `GITHUB_ORG_NAME`: GitHub organization name
- `SLACK_BOT_TOKEN`: Bot user OAuth token (xoxb-)
- `SLACK_SIGNING_SECRET`: Slack app signing secret
- `SLACK_APP_TOKEN`: App-level token for Socket Mode (xapp-)
- `ATLASSIAN_API_KEY`: Atlassian Admin API key
- `ATLASSIAN_ORG_ID`: Atlassian organization ID
- `ATLASSIAN_ADMIN_EMAIL`: Atlassian admin user email

Optional:
- `DATABASE_URL`: PostgreSQL connection string (default: `postgres://postgres:postgres@localhost:5432/dashboard`)
- `API_PORT`: Hono API port (default: 4000)
- `CORS_ORIGIN`: Allowed CORS origin (default: `http://localhost:3001`)
- `PORT`: Slack app port (default: 3000)
- `CRON_SCHEDULE`: GitHub sync cron schedule (default: midnight daily)
- `REMOVE_STOP_LIST`: Comma-separated GitHub usernames to never remove
- `ATLASSIAN_DRY_RUN`: Enable dry-run mode for Atlassian operations

## Runtime

- Built for Bun runtime (not Node.js)
- Uses TypeScript with strict mode enabled
- No build step required for server (noEmit: true in tsconfig)
- Next.js uses standard build process
- Prefer imports without extensions, DO NOT use .js extensions in import paths
