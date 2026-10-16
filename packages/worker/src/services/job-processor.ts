import { Effect, Schedule } from 'effect';
import { describeError } from '../lib/errors';
import { envVars } from '../lib/config';
import { SyncJobRepo } from './sync-job-repo';
import { processGitHubSync } from './sync-engine';
import { SlackNotificationService } from './slack-notification';
import { formatGitHubSyncMessage } from './slack-formatter';

const processNextJob = Effect.gen(function* () {
  const jobRepo = yield* SyncJobRepo;
  const slack = yield* SlackNotificationService;

  const job = yield* jobRepo.claimNextJob;
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
        .pipe(Effect.catch((e) => Effect.logWarning(`Slack notification failed: ${e.message}`)));
    }
  } else {
    yield* Effect.logWarning(`Unknown job type: ${job.type}`);
    yield* jobRepo.failJob(job.id, `Unknown job type: ${job.type}`);
  }
});

export const startJobProcessor = Effect.gen(function* () {
  yield* Effect.log('Starting job processor...');

  // Process immediately, then wait five seconds between completed attempts.
  yield* processNextJob.pipe(
    Effect.catch((e) => Effect.logError(`Error in polling: ${describeError(e)}`)),
    Effect.repeat(Schedule.spaced('5 seconds')),
    Effect.forkChild,
  );

  yield* Effect.log('Job polling started (5s interval)');
});
