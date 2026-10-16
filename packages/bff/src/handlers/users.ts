import { DashboardApi, NotFoundError, type UserStatus } from '@google-github-sync/shared/api';
import { getGitHubUsername, normalizeGitHubUsername } from '@google-github-sync/shared/utils';
import { Effect } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { recordAudit, upstream } from '../lib/effect';
import { GitHubMembership } from '../services/github-membership';
import { GitHubRepos } from '../services/github-repos';
import { GitHubTeams } from '../services/github-teams';
import { GoogleWorkspace } from '../services/google-workspace';

function computeUserStatus(
  githubUsername: string | null,
  memberUsernames: Set<string>,
  invitedUsernames: Set<string>,
): UserStatus {
  if (!githubUsername) return 'not_linked';
  const normalized = normalizeGitHubUsername(githubUsername);
  if (memberUsernames.has(normalized)) return 'member';
  if (invitedUsernames.has(normalized)) return 'pending_invite';
  return 'linked_not_in_org';
}

export const UsersHandlers = HttpApiBuilder.group(
  DashboardApi,
  'users',
  Effect.fn(function* (handlers) {
    const google = yield* GoogleWorkspace;
    const membership = yield* GitHubMembership;
    const teams = yield* GitHubTeams;
    const repos = yield* GitHubRepos;

    const requireUser = (email: string) =>
      upstream(() => google.getUser(email)).pipe(
        Effect.filterOrFail(
          (user) => user !== null,
          () => new NotFoundError({ message: 'User not found' }),
        ),
      );

    const orgState = Effect.all(
      [
        upstream(() => membership.getMemberUsernames()),
        upstream(() => membership.getInvitedUsernames()),
      ],
      { concurrency: 'unbounded' },
    );

    return handlers.handleAll({
      list: Effect.fn(function* () {
        const [workspaceUsers, [memberUsernames, invitedUsernames]] = yield* Effect.all(
          [upstream(() => google.listUsers()), orgState],
          { concurrency: 'unbounded' },
        );

        return workspaceUsers.map((user) => {
          const githubUsername = getGitHubUsername(user);
          return {
            email: user.primaryEmail || '',
            name: user.name?.fullName || null,
            githubUsername,
            status: computeUserStatus(githubUsername, memberUsernames, invitedUsernames),
            avatarUrl: user.thumbnailPhotoUrl || null,
            suspended: user.suspended || false,
          };
        });
      }),

      get: Effect.fn(function* ({ params }) {
        const [user, [memberUsernames, invitedUsernames]] = yield* Effect.all(
          [requireUser(params.email), orgState],
          { concurrency: 'unbounded' },
        );
        const githubUsername = getGitHubUsername(user);

        return {
          email: user.primaryEmail || '',
          name: user.name?.fullName || null,
          givenName: user.name?.givenName || null,
          familyName: user.name?.familyName || null,
          githubUsername,
          status: computeUserStatus(githubUsername, memberUsernames, invitedUsernames),
          avatarUrl: user.thumbnailPhotoUrl || null,
          suspended: user.suspended || false,
        };
      }),

      teams: Effect.fn(function* ({ params }) {
        const githubUsername = getGitHubUsername(yield* requireUser(params.email));
        if (!githubUsername) return [];
        return yield* upstream(() => teams.listTeamsForUser(githubUsername));
      }),

      repos: Effect.fn(function* ({ params }) {
        const githubUsername = getGitHubUsername(yield* requireUser(params.email));
        if (!githubUsername) return { direct: [], teams: [] };

        const userTeams = yield* upstream(() => teams.listTeamsForUser(githubUsername));
        const [direct, viaTeams] = yield* Effect.all(
          [
            upstream(() => repos.listDirectCollaboratorRepos(githubUsername)),
            upstream(() =>
              repos.listReposViaTeams(userTeams.map((t) => ({ slug: t.slug, name: t.name }))),
            ),
          ],
          { concurrency: 'unbounded' },
        );
        return { direct, teams: viaTeams };
      }),

      updateGitHubUsername: Effect.fn(function* ({ params, payload }) {
        const previousUsername = getGitHubUsername(yield* requireUser(params.email));

        yield* upstream(() => google.updateGitHubUsername(params.email, payload.githubUsername));
        yield* recordAudit({
          action: 'update_github_username',
          entityType: 'user',
          entityId: params.email,
          payload: { previousUsername, newUsername: payload.githubUsername },
        });

        return { success: true };
      }),
    });
  }),
);
