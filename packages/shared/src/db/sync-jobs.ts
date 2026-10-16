import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from './index';
import { syncJobs } from './schema';

// Returns the pending or running job of this type, if any. A job left running for
// more than 10 minutes is assumed lost (e.g. the worker died mid-sync) and is
// failed first, so it can't block new jobs of its type indefinitely.
export async function findActiveJob(db: Database, type: string) {
  await db
    .update(syncJobs)
    .set({ status: 'failed', completedAt: new Date(), result: { error: 'Timed out' } })
    .where(
      and(
        eq(syncJobs.type, type),
        eq(syncJobs.status, 'running'),
        sql`${syncJobs.startedAt} < NOW() - INTERVAL '10 minutes'`,
      ),
    );

  const [job] = await db
    .select()
    .from(syncJobs)
    .where(and(eq(syncJobs.type, type), inArray(syncJobs.status, ['pending', 'running'])))
    .limit(1);
  return job;
}
