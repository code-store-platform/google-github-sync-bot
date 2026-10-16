import { DashboardApi } from '@google-github-sync/shared/api';
import { Cause, Effect } from 'effect';
import { FetchHttpClient, HttpClient } from 'effect/http';
import { HttpApiClient } from 'effect/http-api';
import type {
  ActivityType,
  RepoTeamPermission,
  RepoWriteVisibility,
  TeamMemberRole,
  TeamPrivacy,
} from './types';

// The authenticated Next.js proxy keeps BFF credentials on the server.
const API_URL = globalThis.location?.origin || 'http://localhost:3001';

const makeClient = HttpApiClient.make(DashboardApi, { baseUrl: API_URL }).pipe(
  Effect.provide(FetchHttpClient.layer),
);

type Client = Effect.Success<typeof makeClient>;

let client: Promise<Client> | undefined;

// Errors become plain `Error`s so TanStack Query / error boundaries can show `.message`
function toError(e: unknown): Error {
  if (typeof e === 'object' && e !== null && 'message' in e && typeof e.message === 'string') {
    return new Error(e.message || ('_tag' in e ? String(e._tag) : 'API error'));
  }
  return new Error(String(e));
}

async function call<A, E>(request: (client: Client) => Effect.Effect<A, E>): Promise<A> {
  client ??= Effect.runPromise(makeClient);
  const exit = await Effect.runPromiseExit(
    request(await client).pipe(Effect.provideService(HttpClient.TracerPropagationEnabled, false)),
  );
  if (exit._tag === 'Success') return exit.value;
  throw toError(Cause.squash(exit.cause));
}

export const api = {
  getUsers: () => call((c) => c.users.list()),

  getUser: (email: string) => call((c) => c.users.get({ params: { email } })),

  updateGitHubUsername: (email: string, githubUsername: string) =>
    call((c) => c.users.updateGitHubUsername({ params: { email }, payload: { githubUsername } })),

  getUserTeams: (email: string) => call((c) => c.users.teams({ params: { email } })),

  getUserRepos: (email: string) => call((c) => c.users.repos({ params: { email } })),

  triggerSync: () => call((c) => c.sync.triggerGitHub()),

  getSyncJobStatus: (jobId: string) => call((c) => c.sync.job({ params: { id: jobId } })),

  // ── Activity ───────────────────────────────────────────────────────────────

  getActivity: (params?: { page?: number; limit?: number; type?: ActivityType }) =>
    call((c) => c.activity.list({ query: params ?? {} })),

  // ── Teams ──────────────────────────────────────────────────────────────────

  getTeams: () => call((c) => c.teams.list()),

  getTeam: (slug: string) => call((c) => c.teams.get({ params: { slug } })),

  createTeam: (params: { name: string; description?: string; privacy?: TeamPrivacy }) =>
    call((c) => c.teams.create({ payload: params })),

  updateTeam: (
    slug: string,
    params: { name?: string; description?: string; privacy?: TeamPrivacy },
  ) => call((c) => c.teams.update({ params: { slug }, payload: params })),

  deleteTeam: (slug: string) => call((c) => c.teams.delete({ params: { slug } })),

  getTeamMembers: (slug: string) => call((c) => c.teams.members({ params: { slug } })),

  addTeamMember: (slug: string, params: { username: string; role?: TeamMemberRole }) =>
    call((c) => c.teams.addMember({ params: { slug }, payload: params })),

  removeTeamMember: (slug: string, username: string) =>
    call((c) => c.teams.removeMember({ params: { slug, username } })),

  // ── Repos ──────────────────────────────────────────────────────────────────

  getRepos: () => call((c) => c.repos.list()),

  getRepo: (name: string) => call((c) => c.repos.get({ params: { name } })),

  updateRepo: (
    name: string,
    params: {
      description?: string;
      homepage?: string;
      visibility?: RepoWriteVisibility;
      archived?: boolean;
      topics?: string[];
    },
  ) => call((c) => c.repos.update({ params: { name }, payload: params })),

  getRepoTeams: (name: string) => call((c) => c.repos.teams({ params: { name } })),

  addRepoTeamAccess: (name: string, teamSlug: string, permission: RepoTeamPermission) =>
    call((c) => c.repos.addTeam({ params: { name, teamSlug }, payload: { permission } })),

  removeRepoTeamAccess: (name: string, teamSlug: string) =>
    call((c) => c.repos.removeTeam({ params: { name, teamSlug } })),

  addRepoCollaborator: (name: string, username: string, permission: RepoTeamPermission) =>
    call((c) => c.repos.addCollaborator({ params: { name, username }, payload: { permission } })),

  removeRepoCollaborator: (name: string, username: string) =>
    call((c) => c.repos.removeCollaborator({ params: { name, username } })),
};
