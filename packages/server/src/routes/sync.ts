import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { db } from '../db';
import { syncHistory } from '../db/schema';
import { WorkspaceGitHubSync } from '../services/github-sync';

export const syncRoutes = new Hono();

const githubSync = new WorkspaceGitHubSync();

// POST /api/sync/github - Trigger manual GitHub sync
syncRoutes.post('/github', async (c) => {
  const [entry] = await db
    .insert(syncHistory)
    .values({
      syncType: 'github',
      triggeredBy: 'dashboard',
    })
    .returning();

  try {
    const results = await githubSync.syncMembers();

    await db
      .update(syncHistory)
      .set({
        completedAt: new Date(),
        invitedCount: results.invited.length,
        removedCount: results.removed.length,
        errorCount: results.errors.length,
        details: results,
      })
      .where(eq(syncHistory.id, entry.id));

    return c.json(results);
  } catch (error) {
    await db
      .update(syncHistory)
      .set({
        completedAt: new Date(),
        errorCount: 1,
        details: { error: error instanceof Error ? error.message : 'Unknown error' },
      })
      .where(eq(syncHistory.id, entry.id));

    throw error;
  }
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
