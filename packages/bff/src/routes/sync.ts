import { and, desc, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { syncHistory, syncJobs } from '@google-github-sync/shared/db/schema';
import { SYNC_JOBS_CHANNEL } from '@google-github-sync/shared';
import { db } from '../db';

export const syncRoutes = new Hono();

// POST /api/sync/github - Enqueue a GitHub sync job
syncRoutes.post('/github', async (c) => {
  // Check if there's already a pending or running job
  const existing = await db
    .select()
    .from(syncJobs)
    .where(
      and(
        eq(syncJobs.type, 'github_sync'),
        sql`${syncJobs.status} IN ('pending', 'running')`,
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    return c.json(
      { id: existing[0].id, status: existing[0].status, message: 'Sync already in progress' },
      409,
    );
  }

  const [job] = await db
    .insert(syncJobs)
    .values({
      type: 'github_sync',
      triggeredBy: 'dashboard',
    })
    .returning();

  // Notify the worker via LISTEN/NOTIFY
  await db.execute(sql`NOTIFY ${sql.raw(SYNC_JOBS_CHANNEL)}, ${job.id}`);

  return c.json({ id: job.id, status: job.status }, 202);
});

// GET /api/sync/jobs/:id - Poll job status
syncRoutes.get('/jobs/:id', async (c) => {
  const id = c.req.param('id');

  const [job] = await db.select().from(syncJobs).where(eq(syncJobs.id, id)).limit(1);

  if (!job) {
    // Job may have been cleaned up — check sync_history for the result
    throw new HTTPException(404, { message: 'Job not found' });
  }

  return c.json(job);
});

// GET /api/sync/history - Get sync history
syncRoutes.get('/history', async (c) => {
  const limit = Number(c.req.query('limit') || '20');

  const history = await db
    .select()
    .from(syncHistory)
    .orderBy(desc(syncHistory.startedAt))
    .limit(limit);

  return c.json(history);
});
