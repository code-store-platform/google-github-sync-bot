import { DashboardApi } from '@google-github-sync/shared/api';
import { Effect } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { recordAudit, upstream } from '../lib/effect';
import { GitHubTeams } from '../services/github-teams';

export const TeamsHandlers = HttpApiBuilder.group(
  DashboardApi,
  'teams',
  Effect.fn(function* (handlers) {
    const teams = yield* GitHubTeams;

    return handlers.handleAll({
      list: () => upstream(() => teams.listTeams()),

      create: Effect.fn(function* ({ payload }) {
        const team = yield* upstream(() =>
          teams.createTeam({
            name: payload.name.trim(),
            description: payload.description,
            privacy: payload.privacy ?? 'closed',
          }),
        );
        yield* recordAudit({
          action: 'create_team',
          entityType: 'team',
          entityId: team.slug,
          payload: { name: team.name, privacy: team.privacy },
        });
        return team;
      }),

      get: ({ params }) => upstream(() => teams.getTeam(params.slug)),

      update: Effect.fn(function* ({ params, payload }) {
        const team = yield* upstream(() => teams.updateTeam(params.slug, payload));
        yield* recordAudit({
          action: 'update_team',
          entityType: 'team',
          entityId: params.slug,
          payload,
        });
        return team;
      }),

      delete: Effect.fn(function* ({ params }) {
        yield* upstream(() => teams.deleteTeam(params.slug));
        yield* recordAudit({
          action: 'delete_team',
          entityType: 'team',
          entityId: params.slug,
          payload: {},
        });
        return { success: true };
      }),

      members: ({ params }) => upstream(() => teams.listTeamMembers(params.slug)),

      addMember: Effect.fn(function* ({ params, payload }) {
        const username = payload.username.trim();
        const role = payload.role ?? 'member';
        yield* upstream(() => teams.addTeamMember(params.slug, { username, role }));
        yield* recordAudit({
          action: 'add_team_member',
          entityType: 'team',
          entityId: params.slug,
          payload: { username, role },
        });
        return { success: true };
      }),

      removeMember: Effect.fn(function* ({ params }) {
        yield* upstream(() => teams.removeTeamMember(params.slug, params.username));
        yield* recordAudit({
          action: 'remove_team_member',
          entityType: 'team',
          entityId: params.slug,
          payload: { username: params.username },
        });
        return { success: true };
      }),
    });
  }),
);
