import { describe, expect, test, mock, beforeEach } from 'bun:test';

// Mock config to avoid env var validation
mock.module('../lib/config', () => ({
  envVars: {
    GITHUB_TOKEN: 'test-token',
    GITHUB_ORG_NAME: 'test-org',
  },
}));

const mockList = mock();
const mockGetByName = mock();
const mockGetMembershipForUserInOrg = mock();

mock.module('octokit', () => ({
  Octokit: class MockOctokit {
    rest = {
      teams: {
        list: mockList,
        getByName: mockGetByName,
        getMembershipForUserInOrg: mockGetMembershipForUserInOrg,
      },
    };
  },
}));

const { GitHubTeamsService } = await import('./github-teams');

function makeTeamResponse(slug: string, name: string, privacy = 'closed') {
  return {
    data: {
      id: Math.random(),
      slug,
      name,
      description: null,
      privacy,
      members_count: 3,
      repos_count: 1,
      html_url: `https://github.com/orgs/test-org/teams/${slug}`,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
    },
  };
}

describe('GitHubTeamsService.listTeamsForUser', () => {
  let service: InstanceType<typeof GitHubTeamsService>;

  beforeEach(() => {
    service = new GitHubTeamsService();
    mockList.mockReset();
    mockGetByName.mockReset();
    mockGetMembershipForUserInOrg.mockReset();
  });

  test('returns only teams the user belongs to with correct roles', async () => {
    mockList.mockResolvedValueOnce({
      data: [{ slug: 'frontend' }, { slug: 'backend' }, { slug: 'devops' }],
    });

    mockGetByName
      .mockResolvedValueOnce(makeTeamResponse('frontend', 'Frontend'))
      .mockResolvedValueOnce(makeTeamResponse('backend', 'Backend'))
      .mockResolvedValueOnce(makeTeamResponse('devops', 'DevOps'));

    // User is maintainer of frontend, member of devops, not in backend
    mockGetMembershipForUserInOrg
      .mockResolvedValueOnce({ data: { role: 'maintainer' } })
      .mockRejectedValueOnce(new Error('Not Found'))
      .mockResolvedValueOnce({ data: { role: 'member' } });

    const result = await service.listTeamsForUser('alice');

    expect(result).toHaveLength(2);
    expect(result[0].slug).toBe('frontend');
    expect(result[0].role).toBe('maintainer');
    expect(result[1].slug).toBe('devops');
    expect(result[1].role).toBe('member');
  });

  test('returns empty array when user is not in any team', async () => {
    mockList.mockResolvedValueOnce({
      data: [{ slug: 'team-a' }],
    });
    mockGetByName.mockResolvedValueOnce(makeTeamResponse('team-a', 'Team A'));
    mockGetMembershipForUserInOrg.mockRejectedValueOnce(new Error('Not Found'));

    const result = await service.listTeamsForUser('bob');
    expect(result).toHaveLength(0);
  });

  test('returns empty array when org has no teams', async () => {
    mockList.mockResolvedValueOnce({ data: [] });

    const result = await service.listTeamsForUser('charlie');
    expect(result).toHaveLength(0);
  });

  test('handles pagination of teams list', async () => {
    // First page full (100 items), second page partial
    const page1 = Array.from({ length: 100 }, (_, i) => ({ slug: `team-${i}` }));
    const page2 = [{ slug: 'team-100' }];

    mockList.mockResolvedValueOnce({ data: page1 }).mockResolvedValueOnce({ data: page2 });

    // All getTeam calls
    for (let i = 0; i <= 100; i++) {
      mockGetByName.mockResolvedValueOnce(makeTeamResponse(`team-${i}`, `Team ${i}`));
    }

    // User is only in team-50
    for (let i = 0; i <= 100; i++) {
      if (i === 50) {
        mockGetMembershipForUserInOrg.mockResolvedValueOnce({ data: { role: 'member' } });
      } else {
        mockGetMembershipForUserInOrg.mockRejectedValueOnce(new Error('Not Found'));
      }
    }

    const result = await service.listTeamsForUser('dave');

    expect(result).toHaveLength(1);
    expect(result[0].slug).toBe('team-50');
  });
});
