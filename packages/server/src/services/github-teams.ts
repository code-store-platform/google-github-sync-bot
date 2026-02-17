import { Octokit } from 'octokit';
import { envVars } from '../lib/config';

export type GitHubTeam = {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  privacy: 'closed' | 'secret';
  membersCount: number;
  reposCount: number;
  htmlUrl: string;
};

export type GitHubTeamDetail = GitHubTeam & {
  createdAt: string;
  updatedAt: string;
};

export type GitHubTeamMember = {
  login: string;
  id: number;
  avatarUrl: string;
  role: 'member' | 'maintainer';
  htmlUrl: string;
};

export class GitHubTeamsService {
  private octokit: Octokit;
  private readonly orgName: string;

  constructor() {
    this.octokit = new Octokit({ auth: envVars.GITHUB_TOKEN });
    this.orgName = envVars.GITHUB_ORG_NAME;
  }

  async listTeams(): Promise<GitHubTeam[]> {
    // The list endpoint doesn't return members_count/repos_count,
    // so we collect slugs first, then fetch each team's detail in parallel.
    const slugs: string[] = [];
    let page = 1;

    while (true) {
      const { data } = await this.octokit.rest.teams.list({
        org: this.orgName,
        per_page: 100,
        page,
      });

      if (data.length === 0) break;
      for (const t of data) slugs.push(t.slug);
      if (data.length < 100) break;
      page++;
    }

    const teams = await Promise.all(slugs.map((slug) => this.getTeam(slug)));

    return teams;
  }

  async getTeam(slug: string): Promise<GitHubTeamDetail> {
    const { data: t } = await this.octokit.rest.teams.getByName({
      org: this.orgName,
      team_slug: slug,
    });

    return {
      id: t.id,
      slug: t.slug,
      name: t.name,
      description: t.description,
      privacy: (t.privacy as 'closed' | 'secret') || 'closed',
      membersCount: t.members_count ?? 0,
      reposCount: t.repos_count ?? 0,
      htmlUrl: t.html_url,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
    };
  }

  async createTeam(params: {
    name: string;
    description?: string;
    privacy?: 'closed' | 'secret';
  }): Promise<GitHubTeamDetail> {
    const { data: t } = await this.octokit.rest.teams.create({
      org: this.orgName,
      name: params.name,
      description: params.description,
      privacy: params.privacy || 'closed',
    });

    return {
      id: t.id,
      slug: t.slug,
      name: t.name,
      description: t.description ?? null,
      privacy: (t.privacy as 'closed' | 'secret') || 'closed',
      membersCount: t.members_count ?? 0,
      reposCount: t.repos_count ?? 0,
      htmlUrl: t.html_url,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
    };
  }

  async updateTeam(
    slug: string,
    params: {
      name?: string;
      description?: string;
      privacy?: 'closed' | 'secret';
    },
  ): Promise<GitHubTeamDetail> {
    const { data: t } = await this.octokit.rest.teams.updateInOrg({
      org: this.orgName,
      team_slug: slug,
      ...params,
    });

    return {
      id: t.id,
      slug: t.slug,
      name: t.name,
      description: t.description ?? null,
      privacy: (t.privacy as 'closed' | 'secret') || 'closed',
      membersCount: t.members_count ?? 0,
      reposCount: t.repos_count ?? 0,
      htmlUrl: t.html_url,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
    };
  }

  async deleteTeam(slug: string): Promise<void> {
    await this.octokit.rest.teams.deleteInOrg({
      org: this.orgName,
      team_slug: slug,
    });
  }

  async listTeamMembers(slug: string): Promise<GitHubTeamMember[]> {
    const members = await this.octokit.paginate(this.octokit.rest.teams.listMembersInOrg, {
      org: this.orgName,
      team_slug: slug,
      per_page: 100,
    });

    const membersWithRoles = await Promise.all(
      members.map(async (m) => {
        const { data: membership } = await this.octokit.rest.teams.getMembershipForUserInOrg({
          org: this.orgName,
          team_slug: slug,
          username: m.login,
        });

        return {
          login: m.login,
          id: m.id,
          avatarUrl: m.avatar_url,
          role: membership.role as 'member' | 'maintainer',
          htmlUrl: m.html_url,
        };
      }),
    );

    return membersWithRoles;
  }

  async addTeamMember(
    slug: string,
    params: { username: string; role?: 'member' | 'maintainer' },
  ): Promise<void> {
    await this.octokit.rest.teams.addOrUpdateMembershipForUserInOrg({
      org: this.orgName,
      team_slug: slug,
      username: params.username,
      role: params.role || 'member',
    });
  }

  async removeTeamMember(slug: string, username: string): Promise<void> {
    await this.octokit.rest.teams.removeMembershipForUserInOrg({
      org: this.orgName,
      team_slug: slug,
      username,
    });
  }
}
