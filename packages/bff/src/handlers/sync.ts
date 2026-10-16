import {
  DashboardApi,
  NotFoundError,
  SyncInProgressError,
  type SyncJobStatus,
} from '@google-github-sync/shared/api';
import { syncJobs } from '@google-github-sync/shared/db/schema';
import { findActiveJob } from '@google-github-sync/shared/db/sync-jobs';
import { eq } from 'drizzle-orm';
import { Effect } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { db } from '../db';
import { dbQuery } from '../lib/effect';

export const SyncHandlers = HttpApiBuilder.group(DashboardApi, 'sync', (handlers) =>
  handlers.handleAll({
    triggerGitHub: Effect.fn(function* () {
      // Also fails stale running jobs, so a crashed worker can't block manual syncs
      const existing = yield* dbQuery(() => findActiveJob(db, 'github_sync'));

      if (existing) {
        return yield* new SyncInProgressError({
          message: 'Sync already in progress',
          jobId: existing.id,
          status: existing.status,
        });
      }

      const [job] = yield* dbQuery(() =>
        db.insert(syncJobs).values({ type: 'github_sync', triggeredBy: 'dashboard' }).returning(),
      );

      return { id: job.id, status: job.status as SyncJobStatus };
    }),

    job: Effect.fn(function* ({ params }) {
      const [job] = yield* dbQuery(() =>
        db.select().from(syncJobs).where(eq(syncJobs.id, params.id)).limit(1),
      );

      if (!job) {
        return yield* new NotFoundError({ message: 'Job not found' });
      }

      return {
        id: job.id,
        type: job.type,
        status: job.status as SyncJobStatus,
        triggeredBy: job.triggeredBy,
        createdAt: job.createdAt.toISOString(),
        startedAt: job.startedAt?.toISOString() ?? null,
        completedAt: job.completedAt?.toISOString() ?? null,
        result: job.result,
      };
    }),
  }),
);
