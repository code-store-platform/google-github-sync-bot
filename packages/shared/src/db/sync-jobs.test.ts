import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { Database } from './index';
import * as schema from './schema';
import { findActiveJob } from './sync-jobs';

// Explicit opt-in: these tests create and drop only a unique schema in the test database.
const databaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)('findActiveJob (PostgreSQL)', () => {
  const schemaName = `active_job_test_${crypto.randomUUID().replaceAll('-', '')}`;
  let client: ReturnType<typeof postgres>;
  let db: Database;

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required');
    client = postgres(databaseUrl, { connection: { search_path: schemaName } });
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
    db = drizzle(client, { schema });
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

  const insertJob = async (status: string, startedAgo = '0 minutes', type = 'github_sync') => {
    const [row] = await client`
      INSERT INTO sync_jobs (type, status, triggered_by, started_at)
      VALUES (${type}, ${status}, 'test', now() - ${startedAgo}::interval)
      RETURNING id
    `;
    return row.id as string;
  };

  const statusOf = async (id: string) => {
    const [row] = await client`SELECT status, completed_at, result FROM sync_jobs WHERE id = ${id}`;
    return row;
  };

  test('ignores finished jobs', async () => {
    await insertJob('completed');
    await insertJob('failed');
    expect(await findActiveJob(db, 'github_sync')).toBeUndefined();
  });

  test('returns a pending job', async () => {
    const id = await insertJob('pending');
    expect((await findActiveJob(db, 'github_sync'))?.id).toBe(id);
  });

  test('keeps a recently started running job active', async () => {
    const id = await insertJob('running', '9 minutes');
    expect((await findActiveJob(db, 'github_sync'))?.id).toBe(id);
    expect((await statusOf(id)).status).toBe('running');
  });

  test('fails a job left running for over 10 minutes so it no longer blocks', async () => {
    const id = await insertJob('running', '11 minutes');
    expect(await findActiveJob(db, 'github_sync')).toBeUndefined();
    const stored = await statusOf(id);
    expect(stored.status).toBe('failed');
    expect(stored.completed_at).not.toBeNull();
    expect(stored.result).toEqual({ error: 'Timed out' });
  });

  test('only touches jobs of the requested type', async () => {
    const other = await insertJob('running', '11 minutes', 'other_sync');
    expect(await findActiveJob(db, 'github_sync')).toBeUndefined();
    expect((await statusOf(other)).status).toBe('running');
  });
});
