import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/postgres-js';
import { Effect } from 'effect';
import postgres from 'postgres';
import * as schema from '@google-github-sync/shared/db/schema';
import { makeSyncJobRepo } from './sync-job-repo';

// Explicit opt-in: these tests create and drop only a unique schema in the test database.
const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('atomic job claiming (PostgreSQL)', () => {
  const schemaName = `claim_test_${crypto.randomUUID().replaceAll('-', '')}`;
  let client: ReturnType<typeof postgres>;
  let repo: ReturnType<typeof makeSyncJobRepo>;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required');
    client = postgres(databaseUrl, { max: 10, connection: { search_path: schemaName } });
    await client`CREATE SCHEMA ${client(schemaName)}`;
    await client`
      CREATE TABLE sync_jobs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        type text NOT NULL,
        status text NOT NULL DEFAULT 'pending',
        triggered_by text NOT NULL,
        started_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz,
        details jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        result jsonb
      )
    `;
    repo = makeSyncJobRepo(drizzle(client, { schema }));
  });

  beforeEach(async () => {
    await client`TRUNCATE sync_jobs`;
  });

  afterAll(async () => {
    if (!client) return;
    try {
      await client`DROP SCHEMA IF EXISTS ${client(schemaName)} CASCADE`;
    } finally {
      await client.end();
    }
  });

  const claim = () => Effect.runPromise(repo.claimNextJob);

  test('returns null when no pending job exists', async () => {
    expect(await claim()).toBeNull();
    await client`
      INSERT INTO sync_jobs (type, status, triggered_by)
      VALUES ('github_sync', 'running', 'test'),
             ('github_sync', 'completed', 'test'),
             ('github_sync', 'failed', 'test')
    `;
    expect(await claim()).toBeNull();
  });

  test('claims the oldest pending job and persists its running state', async () => {
    await client`
      INSERT INTO sync_jobs (type, triggered_by, created_at, started_at)
      VALUES ('github_sync', 'newer', now(), '2000-01-01'),
             ('github_sync', 'older', now() - interval '1 minute', '2000-01-01')
    `;
    const job = await claim();
    if (!job) throw new Error('Expected a claimed job');
    expect(job.triggeredBy).toBe('older');
    expect(job?.status).toBe('running');
    expect(job?.startedAt.getTime()).toBeGreaterThan(Date.parse('2000-01-01'));
    const [stored] = await client`SELECT status, started_at FROM sync_jobs WHERE id = ${job.id}`;
    expect(stored.status).toBe('running');
    expect(new Date(stored.started_at)).toEqual(job.startedAt);
  });

  test('only one competing worker can claim a single pending job', async () => {
    await client`INSERT INTO sync_jobs (type, triggered_by) VALUES ('github_sync', 'test')`;
    const claims = await Promise.all(Array.from({ length: 20 }, claim));
    expect(claims.filter((job) => job !== null)).toHaveLength(1);
    expect(claims.filter((job) => job === null)).toHaveLength(19);
  });

  test('competing workers claim different rows without losing jobs', async () => {
    await client`
      INSERT INTO sync_jobs (type, triggered_by)
      SELECT 'github_sync', 'test' FROM generate_series(1, 8)
    `;
    const jobs = (await Promise.all(Array.from({ length: 24 }, claim))).filter(
      (job) => job !== null,
    );
    expect(jobs).toHaveLength(8);
    expect(new Set(jobs.map((job) => job.id)).size).toBe(8);
    expect(jobs.every((job) => job.status === 'running')).toBe(true);
    expect(await claim()).toBeNull();
  });

  test('skips a row locked by another worker', async () => {
    const [locked] = await client`
      INSERT INTO sync_jobs (type, triggered_by, created_at)
      VALUES ('github_sync', 'locked', now() - interval '1 minute') RETURNING id
    `;
    await client`INSERT INTO sync_jobs (type, triggered_by) VALUES ('github_sync', 'available')`;
    await client.begin(async (transaction) => {
      await transaction`SELECT id FROM sync_jobs WHERE id = ${locked.id} FOR UPDATE`;
      expect((await claim())?.triggeredBy).toBe('available');
    });
    expect((await claim())?.id).toBe(locked.id);
  });
});
