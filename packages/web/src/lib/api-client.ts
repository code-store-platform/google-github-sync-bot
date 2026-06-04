import type {
  ActivityResponse,
  ActivityType,
  UserDetail,
  UserListItem,
  UserTeamMembership,
  UserReposResponse,
  SyncJob,
  TeamListItem,
  TeamDetail,
  TeamMember,
  RepoListItem,
  RepoDetail,
  RepoTeam,
} from './types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

async function fetchApi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `API error: ${res.status}`);
  }

  return res.json();
}

export const api = {
  getUsers: () => fetchApi<UserListItem[]>('/api/users'),

  getUser: (email: string) => fetchApi<UserDetail>(`/api/users/${encodeURIComponent(email)}`),

  updateGitHubUsername: (email: string, githubUsername: string) =>
    fetchApi<{ success: boolean }>(`/api/users/${encodeURIComponent(email)}/github-username`, {
      method: 'PATCH',
      body: JSON.stringify({ githubUsername }),
    }),

  getUserTeams: (email: string) =>
    fetchApi<UserTeamMembership[]>(`/api/users/${encodeURIComponent(email)}/teams`),

  getUserRepos: (email: string) =>
    fetchApi<UserReposResponse>(`/api/users/${encodeURIComponent(email)}/repos`),

  triggerSync: () =>
    fetchApi<{ id: string; status: string }>('/api/sync/github', {
      method: 'POST',
    }),

  getSyncJobStatus: (jobId: string) => fetchApi<SyncJob>(`/api/sync/jobs/${jobId}`),

  // ── Activity ───────────────────────────────────────────────────────────────

  getActivity: (params?: { page?: number; limit?: number; type?: ActivityType }) => {
    const search = new URLSearchParams();
    if (params?.page) search.set('page', String(params.page));
    if (params?.limit) search.set('limit', String(params.limit));
    if (params?.type) search.set('type', params.type);
    const qs = search.toString();
    return fetchApi<ActivityResponse>(`/api/activity${qs ? `?${qs}` : ''}`);
  },

  // ── Teams ──────────────────────────────────────────────────────────────────

  getTeams: () => fetchApi<TeamListItem[]>('/api/teams'),

  getTeam: (slug: string) => fetchApi<TeamDetail>(`/api/teams/${encodeURIComponent(slug)}`),

  createTeam: (params: { name: string; description?: string; privacy?: string }) =>
    fetchApi<TeamDetail>('/api/teams', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  updateTeam: (slug: string, params: { name?: string; description?: string; privacy?: string }) =>
    fetchApi<TeamDetail>(`/api/teams/${encodeURIComponent(slug)}`, {
      method: 'PATCH',
      body: JSON.stringify(params),
    }),

  deleteTeam: (slug: string) =>
    fetchApi<{ success: boolean }>(`/api/teams/${encodeURIComponent(slug)}`, {
      method: 'DELETE',
    }),

  getTeamMembers: (slug: string) =>
    fetchApi<TeamMember[]>(`/api/teams/${encodeURIComponent(slug)}/members`),

  addTeamMember: (slug: string, params: { username: string; role?: string }) =>
    fetchApi<{ success: boolean }>(`/api/teams/${encodeURIComponent(slug)}/members`, {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  removeTeamMember: (slug: string, username: string) =>
    fetchApi<{ success: boolean }>(
      `/api/teams/${encodeURIComponent(slug)}/members/${encodeURIComponent(username)}`,
      { method: 'DELETE' },
    ),

  // ── Repos ──────────────────────────────────────────────────────────────────

  getRepos: () => fetchApi<RepoListItem[]>('/api/repos'),

  getRepo: (name: string) => fetchApi<RepoDetail>(`/api/repos/${encodeURIComponent(name)}`),

  updateRepo: (
    name: string,
    params: {
      description?: string;
      homepage?: string;
      visibility?: string;
      archived?: boolean;
      topics?: string[];
    },
  ) =>
    fetchApi<RepoDetail>(`/api/repos/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      body: JSON.stringify(params),
    }),

  getRepoTeams: (name: string) =>
    fetchApi<RepoTeam[]>(`/api/repos/${encodeURIComponent(name)}/teams`),

  addRepoTeamAccess: (name: string, teamSlug: string, permission: string) =>
    fetchApi<{ success: boolean }>(
      `/api/repos/${encodeURIComponent(name)}/teams/${encodeURIComponent(teamSlug)}`,
      { method: 'PUT', body: JSON.stringify({ permission }) },
    ),

  removeRepoTeamAccess: (name: string, teamSlug: string) =>
    fetchApi<{ success: boolean }>(
      `/api/repos/${encodeURIComponent(name)}/teams/${encodeURIComponent(teamSlug)}`,
      { method: 'DELETE' },
    ),

  addRepoCollaborator: (name: string, username: string, permission: string) =>
    fetchApi<{ success: boolean }>(
      `/api/repos/${encodeURIComponent(name)}/collaborators/${encodeURIComponent(username)}`,
      { method: 'PUT', body: JSON.stringify({ permission }) },
    ),

  removeRepoCollaborator: (name: string, username: string) =>
    fetchApi<{ success: boolean }>(
      `/api/repos/${encodeURIComponent(name)}/collaborators/${encodeURIComponent(username)}`,
      { method: 'DELETE' },
    ),
};
