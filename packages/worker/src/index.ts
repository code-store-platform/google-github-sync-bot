import { Effect, Layer, Logger } from 'effect';
import { CronJob } from 'cron';
import { envVars } from './lib/config';
import { GoogleWorkspaceService, GoogleWorkspaceServiceLive } from './services/google-workspace';
import { GitHubServiceLive } from './services/github';
import { SlackNotificationServiceLive } from './services/slack-notification';
import { SyncJobRepo, SyncJobRepoLive } from './services/sync-job-repo';
import { startJobProcessor } from './services/job-processor';

// Atlassian (feature-flagged)
import { WorkspaceAtlassianSync } from './services/atlassian/sync';

// -- Compose all layers --
const MainLayer = Layer.mergeAll(
  GoogleWorkspaceServiceLive,
  GitHubServiceLive,
  SlackNotificationServiceLive,
  SyncJobRepoLive,
);

const AppLayer = MainLayer.pipe(Layer.merge(Logger.layer([Logger.consolePretty()])));

// -- Cron: create GitHub sync jobs on schedule --
function startCronJobs() {
  // GitHub sync cron
  const githubCron = new CronJob(envVars.CRON_SCHEDULE, () => {
    const program = Effect.gen(function* () {
      const jobRepo = yield* SyncJobRepo;

      const hasPending = yield* jobRepo.hasPendingOrRunning('github_sync');
      if (hasPending) {
        yield* Effect.log('Skipping cron GitHub sync: job already pending/running');
        return;
      }

      const job = yield* jobRepo.createJob('github_sync', 'cron');
      yield* Effect.log(`Cron created GitHub sync job ${job.id}`);
    });

    Effect.runPromise(program.pipe(Effect.provide(MainLayer))).catch((e) =>
      console.error('Cron GitHub sync error:', e),
    );
  });
  githubCron.start();
  console.log(`GitHub sync cron started (schedule: ${envVars.CRON_SCHEDULE})`);

  // Atlassian cron (feature-flagged)
  if (envVars.ATLASSIAN_ENABLED) {
    const atlassianSync = new WorkspaceAtlassianSync();

    const atlassianCron = new CronJob(envVars.ATLASSIAN_INACTIVITY_CRON_SCHEDULE, async () => {
      console.log('[Atlassian] Starting periodic inactivity check...');
      try {
        const getUsers = Effect.gen(function* () {
          const google = yield* GoogleWorkspaceService;
          return yield* google.getUsers;
        });

        const workspaceUsers = await Effect.runPromise(getUsers.pipe(Effect.provide(MainLayer)));

        atlassianSync.clearCache();
        await atlassianSync.syncSuspensions(workspaceUsers);
        await atlassianSync.check3MonthInactivity(workspaceUsers);
        await atlassianSync.check6MonthInactivity(workspaceUsers);
      } catch (e) {
        console.error('[Atlassian] Periodic check error:', e);
      }
      console.log('[Atlassian] Periodic inactivity check completed.');
    });
    atlassianCron.start();
    console.log(
      `Atlassian inactivity cron started (schedule: ${envVars.ATLASSIAN_INACTIVITY_CRON_SCHEDULE})`,
    );
  }
}

// -- Main --
const main = Effect.gen(function* () {
  yield* Effect.log('Worker starting...');

  // Start job processor (5-second polling)
  yield* startJobProcessor;

  yield* Effect.log('Worker ready');

  // Keep alive
  return yield* Effect.never;
});

// Start cron jobs (outside Effect runtime)
startCronJobs();

// Run the main Effect program
Effect.runFork(main.pipe(Effect.provide(AppLayer), Effect.scoped));

console.log('Worker process started');
