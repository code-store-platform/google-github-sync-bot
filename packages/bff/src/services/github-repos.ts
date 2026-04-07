import { Octokit } from 'octokit';
import { envVars } from '../lib/config';

export type GitHubRepo = {
  id: number;
  name: string;
  fullName: string;
  description: string | null;
  visibility: 'public' | 'private';
  language: string | null;
  stargazersCount: number;
  forksCount: number;
  openIssuesCount: number;
  updatedAt: string;
  htmlUrl: string;
  archived: boolean;
};

export type GitHubRepoDetail = GitHubRepo & {
  defaultBranch: string;
  homepage: string | null;
  topics: string[];
  createdAt: string;
  license: string | null;
};

export type GitHubRepoTeam = {
  id: number;
  slug: string;
  name: string;
  permission: 'pull' | 'triage' | 'push' | 'maintain' | 'admin';
  htmlUrl: string;
};

export type GitHubCollaboratorRepo = {
  name: string;
  fullName: string;
  description: string | null;
  visibility: 'public' | 'private';
  htmlUrl: string;
  archived: boolean;
  permission: 'pull' | 'triage' | 'push' | 'maintain' | 'admin';
};

export type GitHubTeamRepoAccess = {
  name: string;
  fullName: string;
  description: string | null;
  visibility: 'public' | 'private';
  htmlUrl: string;
  archived: boolean;
  permission: 'pull' | 'triage' | 'push' | 'maintain' | 'admin';
  teamSlug: string;
  teamName: string;
};

// GitHub API returns "read"/"write" in role_name but expects "pull"/"push" when writing
function normalizePermission(role: string): GitHubCollaboratorRepo['permission'] {
  switch (role) {
    case 'read':
      return 'pull';
    case 'write':
      return 'push';
    default:
      return role as GitHubCollaboratorRepo['permission'];
  }
}

export class GitHubReposService {
  private octokit: Octokit;
  private readonly orgName: string;

  constructor() {
    this.octokit = new Octokit({ auth: envVars.GITHUB_TOKEN });
    this.orgName = envVars.GITHUB_ORG_NAME;
  }

  async listRepos(): Promise<GitHubRepo[]> {
    const repos = await this.octokit.paginate(this.octokit.rest.repos.listForOrg, {
      org: this.orgName,
      type: 'all',
      sort: 'updated',
      per_page: 100,
    });

    return repos.map((r) => ({
      id: r.id,
      name: r.name,
      fullName: r.full_name,
      description: r.description ?? null,
      visibility: (r.visibility as 'public' | 'private') || (r.private ? 'private' : 'public'),
      language: r.language ?? null,
      stargazersCount: r.stargazers_count ?? 0,
      forksCount: r.forks_count ?? 0,
      openIssuesCount: r.open_issues_count ?? 0,
      updatedAt: r.updated_at ?? '',
      htmlUrl: r.html_url,
      archived: r.archived ?? false,
    }));
  }

  async getRepo(name: string): Promise<GitHubRepoDetail> {
    const { data: r } = await this.octokit.rest.repos.get({
      owner: this.orgName,
      repo: name,
    });

    return {
      id: r.id,
      name: r.name,
      fullName: r.full_name,
      description: r.description ?? null,
      visibility: (r.visibility as 'public' | 'private') || (r.private ? 'private' : 'public'),
      language: r.language ?? null,
      stargazersCount: r.stargazers_count ?? 0,
      forksCount: r.forks_count ?? 0,
      openIssuesCount: r.open_issues_count ?? 0,
      updatedAt: r.updated_at ?? '',
      htmlUrl: r.html_url,
      archived: r.archived ?? false,
      defaultBranch: r.default_branch,
      homepage: r.homepage ?? null,
      topics: r.topics ?? [],
      createdAt: r.created_at ?? '',
      license: r.license?.spdx_id ?? null,
    };
  }

  async updateRepo(
    name: string,
    params: {
      description?: string;
      homepage?: string;
      visibility?: 'public' | 'private';
      archived?: boolean;
    },
  ): Promise<GitHubRepoDetail> {
    const { data: r } = await this.octokit.rest.repos.update({
      owner: this.orgName,
      repo: name,
      ...params,
    });

    return {
      id: r.id,
      name: r.name,
      fullName: r.full_name,
      description: r.description ?? null,
      visibility: (r.visibility as 'public' | 'private') || (r.private ? 'private' : 'public'),
      language: r.language ?? null,
      stargazersCount: r.stargazers_count ?? 0,
      forksCount: r.forks_count ?? 0,
      openIssuesCount: r.open_issues_count ?? 0,
      updatedAt: r.updated_at ?? '',
      htmlUrl: r.html_url,
      archived: r.archived ?? false,
      defaultBranch: r.default_branch,
      homepage: r.homepage ?? null,
      topics: r.topics ?? [],
      createdAt: r.created_at ?? '',
      license: r.license?.spdx_id ?? null,
    };
  }

  async updateTopics(name: string, topics: string[]): Promise<string[]> {
    const { data } = await this.octokit.rest.repos.replaceAllTopics({
      owner: this.orgName,
      repo: name,
      names: topics,
    });

    return data.names;
  }

  async listRepoTeams(name: string): Promise<GitHubRepoTeam[]> {
    const teams = await this.octokit.paginate(this.octokit.rest.repos.listTeams, {
      owner: this.orgName,
      repo: name,
      per_page: 100,
    });

    return teams.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      permission: t.permission as GitHubRepoTeam['permission'],
      htmlUrl: t.html_url,
    }));
  }

  async addTeamAccess(
    name: string,
    teamSlug: string,
    permission: GitHubRepoTeam['permission'],
  ): Promise<void> {
    await this.octokit.rest.teams.addOrUpdateRepoPermissionsInOrg({
      org: this.orgName,
      team_slug: teamSlug,
      owner: this.orgName,
      repo: name,
      permission,
    });
  }

  async removeTeamAccess(name: string, teamSlug: string): Promise<void> {
    await this.octokit.rest.teams.removeRepoInOrg({
      org: this.orgName,
      team_slug: teamSlug,
      owner: this.orgName,
      repo: name,
    });
  }

  async listDirectCollaboratorRepos(username: string): Promise<GitHubCollaboratorRepo[]> {
    const repos = await this.listRepos();

    // Check direct collaborator status for each repo
    const results = await Promise.allSettled(
      repos.map(async (repo) => {
        // List direct collaborators (affiliation=direct) and check if user is among them
        const collaborators = await this.octokit.paginate(
          this.octokit.rest.repos.listCollaborators,
          {
            owner: this.orgName,
            repo: repo.name,
            affiliation: 'direct',
            per_page: 100,
          },
        );

        const match = collaborators.find(
          (c) => c.login.toLowerCase() === username.toLowerCase(),
        );
        if (!match) throw new Error('Not a direct collaborator');

        const permission = normalizePermission(match.role_name ?? 'pull');
        return {
          name: repo.name,
          fullName: repo.fullName,
          description: repo.description,
          visibility: repo.visibility,
          htmlUrl: repo.htmlUrl,
          archived: repo.archived,
          permission,
        };
      }),
    );

    return results
      .filter(
        (r): r is PromiseFulfilledResult<GitHubCollaboratorRepo> => r.status === 'fulfilled',
      )
      .map((r) => r.value);
  }

  async listReposViaTeams(
    userTeams: { slug: string; name: string }[],
  ): Promise<GitHubTeamRepoAccess[]> {
    const teamRepos: GitHubTeamRepoAccess[] = [];

    await Promise.all(
      userTeams.map(async (team) => {
        const repos = await this.octokit.paginate(this.octokit.rest.teams.listReposInOrg, {
          org: this.orgName,
          team_slug: team.slug,
          per_page: 100,
        });

        for (const r of repos) {
          teamRepos.push({
            name: r.name,
            fullName: r.full_name,
            description: r.description ?? null,
            visibility:
              (r.visibility as 'public' | 'private') || (r.private ? 'private' : 'public'),
            htmlUrl: r.html_url,
            archived: r.archived ?? false,
            permission: normalizePermission(r.role_name ?? 'push'),
            teamSlug: team.slug,
            teamName: team.name,
          });
        }
      }),
    );

    return teamRepos;
  }

  async addCollaborator(
    repoName: string,
    username: string,
    permission: GitHubCollaboratorRepo['permission'],
  ): Promise<void> {
    await this.octokit.rest.repos.addCollaborator({
      owner: this.orgName,
      repo: repoName,
      username,
      permission,
    });
  }

  async removeCollaborator(repoName: string, username: string): Promise<void> {
    await this.octokit.rest.repos.removeCollaborator({
      owner: this.orgName,
      repo: repoName,
      username,
    });
  }
}
