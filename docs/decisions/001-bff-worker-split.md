# ADR-001: BFF/Worker Split

**Status:** Accepted  
**Date:** 2026-04-03

## Context

The original server was a single process bundling the Hono API, Slack bot, cron jobs, and sync logic. This made it impossible to scale or deploy the dashboard API independently from the sync engine.

## Decision

Split into two processes sharing the same PostgreSQL database:

- **BFF** — Hono API serving the dashboard. Handles reads (users, teams, repos, sync history), writes (username updates, team/repo CRUD), and enqueues sync jobs.
- **Worker** — Effect.ts process that executes sync jobs, runs cron schedules, and sends Slack notifications.

## Communication

The BFF and worker communicate exclusively through the database:

1. BFF inserts a row into `sync_jobs` (status: `pending`)
2. Worker polls every five seconds and atomically claims a pending job using `FOR UPDATE SKIP LOCKED`
3. Worker executes the sync, writes results to `sync_history`, updates `sync_jobs` status
4. Dashboard polls `GET /api/sync/jobs/:id` for progress

Jobs stuck in `running` for over 10 minutes are automatically failed to prevent deadlocks.

## Audit Trail and Job History

Two separate tables serve different purposes:

- **`sync_jobs`** — Transient queue. Rows are created when a sync is requested (by dashboard or cron) and updated as the worker processes them. Intended for coordination, not long-term storage.
- **`sync_history`** — Permanent, append-only log. The worker writes here after completing a job, recording timing, counts (invited/removed/errors), and full details. This is what the dashboard queries for historical reporting.
- **`audit_log`** — BFF-only. Tracks human-initiated actions from the dashboard (username changes, team/repo management). The worker never writes here; its actions are captured in `sync_history`.

The original notification listener only logged events and did not wake the processor. It has been removed; polling is the sole pickup mechanism. Claiming transitions the job to `running` in the same statement, so competing workers cannot claim the same row.

## Consequences

- BFF is stateless and fast — no long-running sync operations blocking API responses
- Worker can crash/restart without affecting the dashboard
- No new infrastructure — Postgres is the only dependency
- Cron jobs create `sync_jobs` rows like any other trigger, using the same pipeline
