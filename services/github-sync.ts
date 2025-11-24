import { Octokit } from 'octokit';
import { createGoogleAuth, getWorkspaceUsers } from './google-workspace.js';

export type SyncResult = {
  invited: SyncResultUser[];
  removed: string[];
  errors: string[];
};

export type SyncResultUser = {
  username: string;
  email: string;
};

export class WorkspaceGitHubSync {
  private readonly auth;
  private octokit: Octokit;
  private readonly orgName: string;
  private removeStopList: string[] = process.env.REMOVE_STOP_LIST?.split(',') || [];

  constructor() {
    this.auth = createGoogleAuth();

    this.octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN,
    });

    this.orgName = process.env.GITHUB_ORG_NAME!;
  }

  async syncMembers(): Promise<SyncResult> {
    const syncResult: SyncResult = { invited: [], removed: [], errors: [] };
    try {
      const workspaceUsers = await getWorkspaceUsers(this.auth);
      const currentMembers = await this.getGithubMemberUsernames();
      const pendingInvites = await this.getGithubInvitedUsers();

      // get all users with GitHub usernames
      const workspaceGitHubUsernames = new Set(
        workspaceUsers
          .filter(
            (user) =>
              !!user.customSchemas && user.customSchemas['3rd-party_tools']?.GitHub_Username,
          )
          .map((user) => user.customSchemas!['3rd-party_tools']!.GitHub_Username!.toLowerCase()),
      );

      // add users with GitHub usernames to the org
      for (const username of workspaceGitHubUsernames) {
        if (!currentMembers.has(username) && !pendingInvites.has(username)) {
          try {
            const user = await this.octokit.rest.users.getByUsername({
              username,
            });
            const userEmail = workspaceUsers.find(
              (u) =>
                u.customSchemas?.['3rd-party_tools']?.GitHub_Username?.toLowerCase() === username,
            )?.primaryEmail;

            if (!user.data.id || !userEmail) {
              syncResult.errors.push(
                `User ${username} with email ${userEmail} not found on GitHub`,
              );
              continue;
            }

            await this.octokit.rest.orgs.createInvitation({
              org: this.orgName,
              invitee_id: user.data.id,
            });

            syncResult.invited.push({ username, email: userEmail });
          } catch (e) {
            syncResult.errors.push(`Error inviting ${username}`);
            console.error('Error inviting user', e);
          }
        }
      }

      // remove users without GitHub usernames from the org
      for (const member of currentMembers) {
        if (!workspaceGitHubUsernames.has(member) && !this.removeStopList.includes(member)) {
          try {
            await this.octokit.rest.orgs.removeMember({
              org: this.orgName,
              username: member,
            });
            syncResult.removed.push(member);
          } catch (e) {
            syncResult.errors.push(`Error removing ${member}`);
            console.error('Error removing user', e);
          }
        }
      }
    } catch (e) {
      console.error('Error during synchronization', e);
      throw e;
    }

    return syncResult;
  }

  async getGithubMemberUsernames() {
    try {
      const members = await this.octokit.paginate(this.octokit.rest.orgs.listMembers, {
        org: this.orgName,
        per_page: 100,
      });

      return new Set(members.map((member) => member.login.toLowerCase()));
    } catch (error) {
      console.error('Error fetching GitHub members', error);
      throw error;
    }
  }

  async getGithubInvitedUsers() {
    try {
      const invites = await this.octokit.paginate(this.octokit.rest.orgs.listPendingInvitations, {
        org: this.orgName,
        per_page: 100,
      });

      return new Set(
        invites.filter((invite) => invite.login).map((invite) => invite.login!.toLowerCase()),
      );
    } catch (error) {
      console.error('Error fetching GitHub invites', error);
      throw error;
    }
  }
}
