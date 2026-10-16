import { createDb, type Database } from '@google-github-sync/shared/db';
import { syncHistory, syncJobs } from '@google-github-sync/shared/db/schema';
import { findActiveJob } from '@google-github-sync/shared/db/sync-jobs';
import { eq } from 'drizzle-orm';
import { Context, Effect, Layer } from 'effect';
import { envVars } from '../lib/config';
import { describeError, SyncJobError } from '../lib/errors';

export type SyncJob = typeof syncJobs.$inferSelect;

export type SyncCompletionResult = {
  syncType: string;
  startedAt: Date;
  invitedCount: number;
  removedCount: number;
  errorCount: number;
  details: unknown;
  triggeredBy: string;
};

export class SyncJobRepo extends Context.Service<
  SyncJobRepo,
  {
    readonly claimNextJob: Effect.Effect<SyncJob | null, SyncJobError>;
    readonly completeJob: (
      jobId: string,
      result: SyncCompletionResult,
    ) => Effect.Effect<void, SyncJobError>;
    readonly failJob: (jobId: string, error: string) => Effect.Effect<void, SyncJobError>;
    readonly createJob: (type: string, triggeredBy: string) => Effect.Effect<SyncJob, SyncJobError>;
    readonly hasPendingOrRunning: (type: string) => Effect.Effect<boolean, SyncJobError>;
  }
>()('SyncJobRepo') {}

export function makeSyncJobRepo(db: Database) {
  return {
    claimNextJob: Effect.tryPromise({
      try: async () => {
        // Lock and transition in one statement so competing workers cannot claim the same row.
        const nextJob = db
          .select({ id: syncJobs.id })
          .from(syncJobs)
          .where(eq(syncJobs.status, 'pending'))
          .orderBy(syncJobs.createdAt, syncJobs.id)
          .limit(1)
          .for('update', { skipLocked: true });
        const [job] = await db
          .update(syncJobs)
          .set({ status: 'running', startedAt: new Date() })
          .where(eq(syncJobs.id, nextJob))
          .returning();
        return job ?? null;
      },
      catch: (e) => new SyncJobError({ message: `Failed to claim next job: ${describeError(e)}` }),
    }),

    completeJob: (jobId: string, result: SyncCompletionResult) =>
      Effect.tryPromise({
        try: async () => {
          await db.insert(syncHistory).values({
            syncType: result.syncType,
            startedAt: result.startedAt,
            completedAt: new Date(),
            invitedCount: result.invitedCount,
            removedCount: result.removedCount,
            errorCount: result.errorCount,
            details: result.details,
            triggeredBy: result.triggeredBy,
          });

          await db
            .update(syncJobs)
            .set({
              status: 'completed',
              completedAt: new Date(),
              result: result.details,
            })
            .where(eq(syncJobs.id, jobId));
        },
        catch: (e) => new SyncJobError({ message: `Failed to complete job: ${describeError(e)}` }),
      }),

    failJob: (jobId: string, error: string) =>
      Effect.tryPromise({
        try: async () => {
          const [job] = await db.select().from(syncJobs).where(eq(syncJobs.id, jobId)).limit(1);

          const now = new Date();

          await db.insert(syncHistory).values({
            syncType: job?.type ?? 'unknown',
            startedAt: job?.startedAt ?? now,
            completedAt: now,
            invitedCount: 0,
            removedCount: 0,
            errorCount: 1,
            details: { error },
            triggeredBy: job?.triggeredBy ?? 'unknown',
          });

          await db
            .update(syncJobs)
            .set({ status: 'failed', completedAt: now, result: { error } })
            .where(eq(syncJobs.id, jobId));
        },
        catch: (e) => new SyncJobError({ message: `Failed to fail job: ${describeError(e)}` }),
      }),

    createJob: (type: string, triggeredBy: string) =>
      Effect.tryPromise({
        try: async () => {
          const [job] = await db.insert(syncJobs).values({ type, triggeredBy }).returning();
          return job;
        },
        catch: (e) => new SyncJobError({ message: `Failed to create job: ${describeError(e)}` }),
      }),

    hasPendingOrRunning: (type: string) =>
      Effect.tryPromise({
        try: async () => !!(await findActiveJob(db, type)),
        catch: (e) =>
          new SyncJobError({ message: `Failed to check pending jobs: ${describeError(e)}` }),
      }),
  };
}

export const SyncJobRepoLive = Layer.sync(SyncJobRepo, () =>
  makeSyncJobRepo(createDb(envVars.DATABASE_URL)),
);
