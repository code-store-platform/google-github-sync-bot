import { Effect } from 'effect';
import { normalizeGitHubUsername, getGitHubUsername } from '@google-github-sync/shared/utils';
import { envVars } from '../lib/config';
import { GitHubService } from './github';
import { GoogleWorkspaceService } from './google-workspace';
import { SyncJobRepo } from './sync-job-repo';

export type SyncResult = {
  invited: { username: string; email: string }[];
  removed: string[];
  errors: string[];
};

const runSync = Effect.gen(function* () {
  const google = yield* GoogleWorkspaceService;
  const github = yield* GitHubService;

  const result: SyncResult = { invited: [], removed: [], errors: [] };

  const [workspaceUsers, currentMembers, pendingInvites] = yield* Effect.all([
    google.getUsers(),
    github.getMemberUsernames(),
    github.getInvitedUsernames(),
  ]);

  // Build set of workspace users with GitHub usernames
  const workspaceGitHubUsernames = new Map<string, string>();
  for (const user of workspaceUsers) {
    const ghUsername = getGitHubUsername(user);
    if (ghUsername) {
      workspaceGitHubUsernames.set(normalizeGitHubUsername(ghUsername), user.primaryEmail || '');
    }
  }

  // Invite users with GitHub usernames not yet in org
  for (const [username, email] of workspaceGitHubUsernames) {
    if (!currentMembers.has(username) && !pendingInvites.has(username)) {
      const inviteResult = yield* Effect.either(github.inviteUser(username));
      if (inviteResult._tag === 'Right') {
        result.invited.push({ username, email });
      } else {
        result.errors.push(`Error inviting ${username}: ${inviteResult.left.message}`);
      }
    }
  }

  // Remove org members not in workspace (respecting stop list)
  const removeStopList = new Set(envVars.REMOVE_STOP_LIST.map((u) => normalizeGitHubUsername(u)));
  for (const member of currentMembers) {
    if (!workspaceGitHubUsernames.has(member) && !removeStopList.has(member)) {
      const removeResult = yield* Effect.either(github.removeMember(member));
      if (removeResult._tag === 'Right') {
        result.removed.push(member);
      } else {
        result.errors.push(`Error removing ${member}: ${removeResult.left.message}`);
      }
    }
  }

  return result;
});

export const processGitHubSync = (jobId: string) =>
  Effect.gen(function* () {
    const jobRepo = yield* SyncJobRepo;

    const startedAt = new Date();
    yield* jobRepo.markRunning(jobId);
    yield* Effect.log(`Processing GitHub sync job ${jobId}`);

    const syncResult = yield* runSync.pipe(
      Effect.catchAll((error) => {
        return Effect.gen(function* () {
          yield* jobRepo.failJob(jobId, error.message);
          yield* Effect.logError(`GitHub sync failed: ${error.message}`);
          return { invited: [], removed: [], errors: [error.message] } as SyncResult;
        });
      }),
    );

    // If the job wasn't already failed by the catch above
    if (syncResult.errors.length === 0 || syncResult.invited.length > 0 || syncResult.removed.length > 0) {
      yield* jobRepo.completeJob(jobId, {
        syncType: 'github',
        startedAt,
        invitedCount: syncResult.invited.length,
        removedCount: syncResult.removed.length,
        errorCount: syncResult.errors.length,
        details: syncResult,
        triggeredBy: 'worker',
      });
    }

    yield* Effect.log(
      `GitHub sync done: ${syncResult.invited.length} invited, ${syncResult.removed.length} removed, ${syncResult.errors.length} errors`,
    );

    return syncResult;
  });
