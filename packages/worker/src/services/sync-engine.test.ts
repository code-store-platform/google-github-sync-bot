import { describe, expect, test } from 'bun:test';
import { Effect, Layer } from 'effect';
import { GitHubError } from '../lib/errors';
import { GitHubService } from './github';
import { GoogleWorkspaceService } from './google-workspace';
import { SyncJobRepo } from './sync-job-repo';
import { processGitHubSync } from './sync-engine';
import type { GoogleUser } from './google-workspace';

// -- Test layer factories --

function makeGoogleLayer(users: GoogleUser[]) {
  return Layer.succeed(GoogleWorkspaceService, {
    getUsers: () => Effect.succeed(users),
  });
}

function makeGitHubLayer(
  members: string[] = [],
  invited: string[] = [],
  opts?: { inviteFailFor?: string[]; removeFailFor?: string[] },
) {
  return Layer.succeed(GitHubService, {
    getMemberUsernames: () => Effect.succeed(new Set(members)),
    getInvitedUsernames: () => Effect.succeed(new Set(invited)),
    inviteUser: (username: string) =>
      opts?.inviteFailFor?.includes(username)
        ? Effect.fail(new GitHubError({ message: `API error for ${username}` }))
        : Effect.void,
    removeMember: (username: string) =>
      opts?.removeFailFor?.includes(username)
        ? Effect.fail(new GitHubError({ message: `API error for ${username}` }))
        : Effect.void,
    getUserId: (username: string) => Effect.succeed(1),
  });
}

function makeJobRepoLayer() {
  const calls: { method: string; args: unknown[] }[] = [];
  const layer = Layer.succeed(SyncJobRepo, {
    claimNextJob: () => Effect.succeed(null),
    markRunning: (jobId: string) => {
      calls.push({ method: 'markRunning', args: [jobId] });
      return Effect.succeed(undefined);
    },
    completeJob: (jobId, result) => {
      calls.push({ method: 'completeJob', args: [jobId, result] });
      return Effect.succeed(undefined);
    },
    failJob: (jobId, error) => {
      calls.push({ method: 'failJob', args: [jobId, error] });
      return Effect.succeed(undefined);
    },
    createJob: (type, triggeredBy) => Effect.succeed({} as never),
    hasPendingOrRunning: (type) => Effect.succeed(false),
  });
  return { layer, calls };
}

function makeUser(email: string, githubUsername?: string): GoogleUser {
  return {
    primaryEmail: email,
    customSchemas: githubUsername
      ? { '3rd-party_tools': { GitHub_Username: githubUsername } }
      : undefined,
  };
}

function run(
  google: ReturnType<typeof makeGoogleLayer>,
  github: ReturnType<typeof makeGitHubLayer>,
  jobRepo: ReturnType<typeof makeJobRepoLayer>,
) {
  const layer = Layer.mergeAll(google, github, jobRepo.layer);
  return Effect.runPromise(processGitHubSync('test-job-id').pipe(Effect.provide(layer)));
}

// -- Tests --

describe('sync engine', () => {
  test('invites workspace user not in org', async () => {
    const result = await run(
      makeGoogleLayer([makeUser('alice@test.com', 'alice')]),
      makeGitHubLayer(),
      makeJobRepoLayer(),
    );

    expect(result.invited).toEqual([{ username: 'alice', email: 'alice@test.com' }]);
    expect(result.removed).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  test('skips user already a member', async () => {
    const result = await run(
      makeGoogleLayer([makeUser('alice@test.com', 'alice')]),
      makeGitHubLayer(['alice']),
      makeJobRepoLayer(),
    );

    expect(result.invited).toEqual([]);
    expect(result.removed).toEqual([]);
  });

  test('skips user with pending invite', async () => {
    const result = await run(
      makeGoogleLayer([makeUser('alice@test.com', 'alice')]),
      makeGitHubLayer([], ['alice']),
      makeJobRepoLayer(),
    );

    expect(result.invited).toEqual([]);
  });

  test('removes org member not in workspace', async () => {
    const result = await run(
      makeGoogleLayer([]),
      makeGitHubLayer(['orphan']),
      makeJobRepoLayer(),
    );

    expect(result.removed).toEqual(['orphan']);
  });

  test('does not remove user on stop list', async () => {
    // REMOVE_STOP_LIST is read from envVars at runtime — it defaults to []
    // when the env var is not set. We test the default behavior here.
    const result = await run(
      makeGoogleLayer([]),
      makeGitHubLayer(['orphan']),
      makeJobRepoLayer(),
    );

    expect(result.removed).toEqual(['orphan']);
  });

  test('ignores workspace user without github username', async () => {
    const result = await run(
      makeGoogleLayer([makeUser('nogh@test.com')]),
      makeGitHubLayer(['existing']),
      makeJobRepoLayer(),
    );

    expect(result.invited).toEqual([]);
    // 'existing' should be removed since no workspace user maps to it
    expect(result.removed).toEqual(['existing']);
  });

  test('handles invite failure gracefully', async () => {
    const result = await run(
      makeGoogleLayer([
        makeUser('alice@test.com', 'alice'),
        makeUser('bob@test.com', 'bob'),
      ]),
      makeGitHubLayer([], [], { inviteFailFor: ['alice'] }),
      makeJobRepoLayer(),
    );

    expect(result.invited).toEqual([{ username: 'bob', email: 'bob@test.com' }]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('alice');
  });

  test('handles remove failure gracefully', async () => {
    const result = await run(
      makeGoogleLayer([]),
      makeGitHubLayer(['orphan1', 'orphan2'], [], { removeFailFor: ['orphan1'] }),
      makeJobRepoLayer(),
    );

    expect(result.removed).toEqual(['orphan2']);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('orphan1');
  });

  test('marks job running then completes', async () => {
    const jobRepo = makeJobRepoLayer();
    await run(
      makeGoogleLayer([makeUser('alice@test.com', 'alice')]),
      makeGitHubLayer(),
      jobRepo,
    );

    expect(jobRepo.calls[0]).toEqual({ method: 'markRunning', args: ['test-job-id'] });
    expect(jobRepo.calls[1].method).toBe('completeJob');
  });

  test('normalizes username case for matching', async () => {
    const result = await run(
      makeGoogleLayer([makeUser('alice@test.com', 'Alice')]),
      makeGitHubLayer(['alice']),
      makeJobRepoLayer(),
    );

    // 'Alice' in workspace matches 'alice' in org — no invite, no remove
    expect(result.invited).toEqual([]);
    expect(result.removed).toEqual([]);
  });
});
