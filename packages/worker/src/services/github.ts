import { Context, Effect, Layer } from 'effect';
import { Octokit } from 'octokit';
import { normalizeGitHubUsername } from '@google-github-sync/shared/utils';
import { describeError, GitHubError } from '../lib/errors';
import { envVars } from '../lib/config';

export class GitHubService extends Context.Tag('GitHubService')<
  GitHubService,
  {
    readonly getMemberUsernames: () => Effect.Effect<Set<string>, GitHubError>;
    readonly getInvitedUsernames: () => Effect.Effect<Set<string>, GitHubError>;
    readonly inviteUser: (username: string) => Effect.Effect<void, GitHubError>;
    readonly removeMember: (username: string) => Effect.Effect<void, GitHubError>;
    readonly getUserId: (username: string) => Effect.Effect<number, GitHubError>;
  }
>() {}

export const GitHubServiceLive = Layer.sync(GitHubService, () => {
  const octokit = new Octokit({ auth: envVars.GITHUB_TOKEN });
  const orgName = envVars.GITHUB_ORG_NAME;

  return {
    getMemberUsernames: () =>
      Effect.tryPromise({
        try: async () => {
          const members = await octokit.paginate(octokit.rest.orgs.listMembers, {
            org: orgName,
            per_page: 100,
          });
          return new Set(members.map((m) => normalizeGitHubUsername(m.login)));
        },
        catch: (e) => new GitHubError({ message: `Failed to fetch members: ${describeError(e)}` }),
      }),

    getInvitedUsernames: () =>
      Effect.tryPromise({
        try: async () => {
          const invites = await octokit.paginate(octokit.rest.orgs.listPendingInvitations, {
            org: orgName,
            per_page: 100,
          });
          return new Set(
            invites
              .filter((i) => i.login)
              .map((i) => normalizeGitHubUsername(i.login || '')),
          );
        },
        catch: (e) => new GitHubError({ message: `Failed to fetch invites: ${describeError(e)}` }),
      }),

    inviteUser: (username: string) =>
      Effect.tryPromise({
        try: async () => {
          const user = await octokit.rest.users.getByUsername({ username });
          await octokit.rest.orgs.createInvitation({
            org: orgName,
            invitee_id: user.data.id,
          });
        },
        catch: (e) => new GitHubError({ message: `Failed to invite ${username}: ${describeError(e)}` }),
      }),

    removeMember: (username: string) =>
      Effect.tryPromise({
        try: async () => {
          await octokit.rest.orgs.removeMember({ org: orgName, username });
        },
        catch: (e) => new GitHubError({ message: `Failed to remove ${username}: ${describeError(e)}` }),
      }),

    getUserId: (username: string) =>
      Effect.tryPromise({
        try: async () => {
          const user = await octokit.rest.users.getByUsername({ username });
          return user.data.id;
        },
        catch: (e) => new GitHubError({ message: `Failed to get user ID for ${username}: ${describeError(e)}` }),
      }),
  };
});
