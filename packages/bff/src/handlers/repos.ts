import { DashboardApi } from '@google-github-sync/shared/api';
import { Effect } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { recordAudit, upstream } from '../lib/effect';
import { GitHubRepos } from '../services/github-repos';

export const ReposHandlers = HttpApiBuilder.group(
  DashboardApi,
  'repos',
  Effect.fn(function* (handlers) {
    const repos = yield* GitHubRepos;

    return handlers.handleAll({
      list: () => upstream(() => repos.listRepos()),

      get: ({ params }) => upstream(() => repos.getRepo(params.name)),

      update: Effect.fn(function* ({ params, payload }) {
        const { topics, ...updates } = payload;

        if (topics) {
          yield* upstream(() => repos.updateTopics(params.name, [...topics]));
        }

        const repo = yield* upstream(() =>
          Object.keys(updates).length > 0
            ? repos.updateRepo(params.name, updates)
            : repos.getRepo(params.name),
        );

        yield* recordAudit({
          action: 'update_repo',
          entityType: 'repo',
          entityId: params.name,
          payload: { ...updates, ...(topics ? { topics } : {}) },
        });

        return repo;
      }),

      teams: ({ params }) => upstream(() => repos.listRepoTeams(params.name)),

      addTeam: Effect.fn(function* ({ params, payload }) {
        const permission = payload.permission ?? 'push';
        yield* upstream(() => repos.addTeamAccess(params.name, params.teamSlug, permission));
        yield* recordAudit({
          action: 'add_repo_team_access',
          entityType: 'repo',
          entityId: params.name,
          payload: { teamSlug: params.teamSlug, permission },
        });
        return { success: true };
      }),

      removeTeam: Effect.fn(function* ({ params }) {
        yield* upstream(() => repos.removeTeamAccess(params.name, params.teamSlug));
        yield* recordAudit({
          action: 'remove_repo_team_access',
          entityType: 'repo',
          entityId: params.name,
          payload: { teamSlug: params.teamSlug },
        });
        return { success: true };
      }),

      addCollaborator: Effect.fn(function* ({ params, payload }) {
        const permission = payload.permission ?? 'push';
        yield* upstream(() => repos.addCollaborator(params.name, params.username, permission));
        yield* recordAudit({
          action: 'add_repo_collaborator',
          entityType: 'repo',
          entityId: params.name,
          payload: { username: params.username, permission },
        });
        return { success: true };
      }),

      removeCollaborator: Effect.fn(function* ({ params }) {
        yield* upstream(() => repos.removeCollaborator(params.name, params.username));
        yield* recordAudit({
          action: 'remove_repo_collaborator',
          entityType: 'repo',
          entityId: params.name,
          payload: { username: params.username },
        });
        return { success: true };
      }),
    });
  }),
);
