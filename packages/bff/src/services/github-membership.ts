import { normalizeGitHubUsername } from '@google-github-sync/shared/utils';
import { Octokit } from 'octokit';
import { envVars } from '../lib/config';

export class GitHubMembershipService {
  private octokit: Octokit;
  private readonly orgName: string;

  constructor() {
    this.octokit = new Octokit({ auth: envVars.GITHUB_TOKEN });
    this.orgName = envVars.GITHUB_ORG_NAME;
  }

  async getMemberUsernames(): Promise<Set<string>> {
    const members = await this.octokit.paginate(this.octokit.rest.orgs.listMembers, {
      org: this.orgName,
      per_page: 100,
    });

    return new Set(members.map((member) => normalizeGitHubUsername(member.login)));
  }

  async getInvitedUsernames(): Promise<Set<string>> {
    const invites = await this.octokit.paginate(this.octokit.rest.orgs.listPendingInvitations, {
      org: this.orgName,
      per_page: 100,
    });

    return new Set(
      invites
        .filter((invite) => invite.login)
        .map((invite) => normalizeGitHubUsername(invite.login || '')),
    );
  }
}
