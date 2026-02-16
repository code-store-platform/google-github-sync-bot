import type { UserDetail, UserListItem, SyncHistoryEntry } from './types';

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
};
