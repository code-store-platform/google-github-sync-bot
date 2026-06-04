import { Effect, Schedule } from 'effect';
import postgres from 'postgres';
import { SYNC_JOBS_CHANNEL } from '@google-github-sync/shared';
import { describeError, JobProcessorError } from '../lib/errors';
import { envVars } from '../lib/config';
import { SyncJobRepo } from './sync-job-repo';
import { processGitHubSync } from './sync-engine';
import { SlackNotificationService } from './slack-notification';
import { formatGitHubSyncMessage } from './slack-formatter';

const processNextJob = Effect.gen(function* () {
  const jobRepo = yield* SyncJobRepo;
  const slack = yield* SlackNotificationService;

  const job = yield* jobRepo.claimNextJob();
  if (!job) return;

  yield* Effect.log(`Picked up job ${job.id} (type: ${job.type})`);

  if (job.type === 'github_sync') {
    const result = yield* processGitHubSync(job.id);

    // Send Slack notification if there were changes
    if (
      slack.isEnabled &&
      envVars.SLACK_NOTIFICATION_CHANNEL &&
      (result.invited.length > 0 || result.removed.length > 0 || result.errors.length > 0)
    ) {
      const msg = formatGitHubSyncMessage(result);
      yield* slack
        .sendNotification({
          channel: envVars.SLACK_NOTIFICATION_CHANNEL,
          text: msg.text,
          blocks: msg.blocks,
        })
        .pipe(Effect.catchAll((e) => Effect.logWarning(`Slack notification failed: ${e.message}`)));
    }
  } else {
    yield* Effect.logWarning(`Unknown job type: ${job.type}`);
    yield* jobRepo.failJob(job.id, `Unknown job type: ${job.type}`);
  }
});

export const startJobProcessor = Effect.gen(function* () {
  yield* Effect.log('Starting job processor...');

  // Process any jobs that were pending before we started
  yield* processNextJob.pipe(
    Effect.catchAll((e) => Effect.logError(`Error processing job: ${describeError(e)}`)),
  );

  // Set up LISTEN/NOTIFY - uses a dedicated connection
  const listenerSql = postgres(envVars.DATABASE_URL);

  yield* Effect.addFinalizer(() =>
    Effect.promise(async () => {
      await listenerSql.end();
    }),
  );

  yield* Effect.tryPromise({
    try: async () => {
      await listenerSql.listen(SYNC_JOBS_CHANNEL, () => {
        // When notified, schedule a processNextJob run
        // We use Effect.runFork but need to handle that this runs outside managed scope
        console.log('[NOTIFY] sync_jobs_channel triggered');
      });
    },
    catch: (e) =>
      new JobProcessorError({ message: `Failed to set up LISTEN: ${describeError(e)}` }),
  });

  yield* Effect.log('Listening for sync_jobs_channel notifications');

  // Polling every 5 seconds (also handles NOTIFY events since the
  // listener callback just logs — the poll loop picks up the job)
  yield* processNextJob.pipe(
    Effect.catchAll((e) => Effect.logError(`Error in polling: ${describeError(e)}`)),
    Effect.repeat(Schedule.spaced('5 seconds')),
    Effect.fork,
  );

  yield* Effect.log('Job polling started (5s interval)');
});
