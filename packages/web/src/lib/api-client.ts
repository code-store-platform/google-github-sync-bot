import type {
  UserDetail,
  UserListItem,
  SyncHistoryEntry,
  TeamListItem,
  TeamDetail,
  TeamMember,
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

  triggerSync: () =>
    fetchApi<{ invited: unknown[]; removed: string[]; errors: string[] }>('/api/sync/github', {
      method: 'POST',
    }),

  getSyncHistory: (limit = 20) => fetchApi<SyncHistoryEntry[]>(`/api/sync/history?limit=${limit}`),

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
};
