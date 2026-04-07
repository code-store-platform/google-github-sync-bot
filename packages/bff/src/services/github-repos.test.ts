import { describe, expect, test, mock, beforeEach } from 'bun:test';

mock.module('../lib/config', () => ({
  envVars: {
    GITHUB_TOKEN: 'test-token',
    GITHUB_ORG_NAME: 'test-org',
  },
}));

const mockListForOrg = mock();
const mockListCollaborators = mock();
const mockAddCollaborator = mock();
const mockRemoveCollaborator = mock();
const mockListReposInOrg = mock();

// Track paginate calls by the function reference passed
const paginateResults = new Map<unknown, unknown[]>();

mock.module('octokit', () => ({
  Octokit: class MockOctokit {
    rest = {
      repos: {
        listForOrg: mockListForOrg,
        get: mock(),
        update: mock(),
        replaceAllTopics: mock(),
        listTeams: mock(),
        listCollaborators: mockListCollaborators,
        addCollaborator: mockAddCollaborator,
        removeCollaborator: mockRemoveCollaborator,
      },
      teams: {
        addOrUpdateRepoPermissionsInOrg: mock(),
        removeRepoInOrg: mock(),
        listReposInOrg: mockListReposInOrg,
      },
    };
    paginate = mock(async (fn: unknown) => {
      return paginateResults.get(fn) ?? [];
    });
  },
}));

const { GitHubReposService } = await import('./github-repos');

function makeRepoData(name: string, isPrivate = false) {
  return {
    id: Math.random(),
    name,
    full_name: `test-org/${name}`,
    description: null,
    visibility: isPrivate ? 'private' : 'public',
    private: isPrivate,
    language: null,
    stargazers_count: 0,
    forks_count: 0,
    open_issues_count: 0,
    updated_at: '2024-01-01T00:00:00Z',
    html_url: `https://github.com/test-org/${name}`,
    archived: false,
  };
}

describe('GitHubReposService.listDirectCollaboratorRepos', () => {
  let service: InstanceType<typeof GitHubReposService>;

  beforeEach(() => {
    service = new GitHubReposService();
    paginateResults.clear();
    mockListCollaborators.mockReset();
  });

  test('returns repos where user is a direct collaborator', async () => {
    // listRepos uses paginate with listForOrg
    const repos = [makeRepoData('repo-a'), makeRepoData('repo-b'), makeRepoData('repo-c')];
    // First paginate call is for listRepos (listForOrg)
    // Second+ calls are for listCollaborators per repo
    let paginateCallCount = 0;
    service['octokit'].paginate = mock(async (fn: unknown, params: Record<string, unknown>) => {
      paginateCallCount++;
      if (paginateCallCount === 1) {
        // listRepos -> listForOrg
        return repos;
      }
      // listCollaborators calls - affiliation: 'direct'
      const repoName = params.repo as string;
      if (repoName === 'repo-a') {
        return [{ login: 'alice', role_name: 'push' }];
      }
      if (repoName === 'repo-b') {
        return []; // alice not a collaborator
      }
      if (repoName === 'repo-c') {
        return [{ login: 'Alice', role_name: 'admin' }]; // case-insensitive match
      }
      return [];
    });

    const result = await service.listDirectCollaboratorRepos('alice');

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe('repo-a');
    expect(result[0].permission).toBe('push');
    expect(result[1].name).toBe('repo-c');
    expect(result[1].permission).toBe('admin');
  });

  test('returns empty array when user has no direct access', async () => {
    const repos = [makeRepoData('repo-a')];
    let paginateCallCount = 0;
    service['octokit'].paginate = mock(async () => {
      paginateCallCount++;
      if (paginateCallCount === 1) return repos;
      return [];
    });

    const result = await service.listDirectCollaboratorRepos('bob');
    expect(result).toHaveLength(0);
  });

  test('returns empty array when org has no repos', async () => {
    service['octokit'].paginate = mock(async () => []);

    const result = await service.listDirectCollaboratorRepos('charlie');
    expect(result).toHaveLength(0);
  });
});

describe('GitHubReposService.listReposViaTeams', () => {
  let service: InstanceType<typeof GitHubReposService>;

  beforeEach(() => {
    service = new GitHubReposService();
  });

  test('returns repos from multiple teams', async () => {
    service['octokit'].paginate = mock(
      async (_fn: unknown, params: Record<string, unknown>) => {
        const teamSlug = params.team_slug as string;
        if (teamSlug === 'frontend') {
          return [
            {
              name: 'web-app',
              full_name: 'test-org/web-app',
              description: 'The web app',
              visibility: 'private',
              private: true,
              html_url: 'https://github.com/test-org/web-app',
              archived: false,
              role_name: 'push',
            },
          ];
        }
        if (teamSlug === 'backend') {
          return [
            {
              name: 'api-server',
              full_name: 'test-org/api-server',
              description: null,
              visibility: 'public',
              private: false,
              html_url: 'https://github.com/test-org/api-server',
              archived: false,
              role_name: 'admin',
            },
          ];
        }
        return [];
      },
    );

    const result = await service.listReposViaTeams([
      { slug: 'frontend', name: 'Frontend' },
      { slug: 'backend', name: 'Backend' },
    ]);

    expect(result).toHaveLength(2);
    expect(result.find((r) => r.name === 'web-app')?.teamName).toBe('Frontend');
    expect(result.find((r) => r.name === 'api-server')?.teamName).toBe('Backend');
    expect(result.find((r) => r.name === 'api-server')?.permission).toBe('admin');
  });

  test('returns empty array when teams have no repos', async () => {
    service['octokit'].paginate = mock(async () => []);

    const result = await service.listReposViaTeams([{ slug: 'empty-team', name: 'Empty' }]);
    expect(result).toHaveLength(0);
  });

  test('returns empty array when no teams provided', async () => {
    const result = await service.listReposViaTeams([]);
    expect(result).toHaveLength(0);
  });
});

describe('GitHubReposService.addCollaborator', () => {
  let service: InstanceType<typeof GitHubReposService>;

  beforeEach(() => {
    service = new GitHubReposService();
    mockAddCollaborator.mockReset();
  });

  test('calls octokit with correct params', async () => {
    mockAddCollaborator.mockResolvedValueOnce({});

    await service.addCollaborator('my-repo', 'alice', 'push');

    expect(mockAddCollaborator).toHaveBeenCalledWith({
      owner: 'test-org',
      repo: 'my-repo',
      username: 'alice',
      permission: 'push',
    });
  });
});

describe('GitHubReposService.removeCollaborator', () => {
  let service: InstanceType<typeof GitHubReposService>;

  beforeEach(() => {
    service = new GitHubReposService();
    mockRemoveCollaborator.mockReset();
  });

  test('calls octokit with correct params', async () => {
    mockRemoveCollaborator.mockResolvedValueOnce({});

    await service.removeCollaborator('my-repo', 'alice');

    expect(mockRemoveCollaborator).toHaveBeenCalledWith({
      owner: 'test-org',
      repo: 'my-repo',
      username: 'alice',
    });
  });
});
