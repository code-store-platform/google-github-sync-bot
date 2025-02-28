import { google } from 'googleapis';
import * as dotenv from 'dotenv';
import { App } from '@slack/bolt';
import { Octokit } from 'octokit';

dotenv.config();

type GoogleUser = {
  primaryEmail?: string | null;
  customSchemas?: {
    '3rd-party_tools'?: {
      GitHub_Username?: string;
    } | null;
  } | null;
};

type SyncResult = {
  invited: string[];
  removed: string[];
  errors: string[];
};

class WorkspaceGitHubSync {
  private readonly auth;
  private octokit: Octokit;
  private readonly orgName: string;
  private removeStopList: string[] =
    process.env.REMOVE_STOP_LIST?.split(',') || [];

  constructor() {
    this.auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      scopes: ['https://www.googleapis.com/auth/admin.directory.user.readonly'],
      clientOptions: {
        subject: process.env.GOOGLE_ADMIN_EMAIL, // impersonate the admin user
      },
    });

    this.octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN,
    });

    this.orgName = process.env.GITHUB_ORG_NAME!;
  }

  async syncMembers(): Promise<SyncResult> {
    const syncResult: SyncResult = { invited: [], removed: [], errors: [] };
    try {
      const workspaceUsers = await this.getWorkspaceUsers();
      const currentMembers = await this.getGithubMemberUsernames();
      const pendingInvites = await this.getGithubInvitedUsers();

      // get all users with GitHub usernames
      const workspaceGitHubUsernames = new Set(
        workspaceUsers
          .filter(
            (user) =>
              !!user.customSchemas &&
              user.customSchemas['3rd-party_tools']?.GitHub_Username,
          )
          .map((user) =>
            user.customSchemas![
              '3rd-party_tools'
            ]!.GitHub_Username!.toLowerCase(),
          ),
      );

      // add users with GitHub usernames to the org
      for (const username of workspaceGitHubUsernames) {
        if (!currentMembers.has(username) && !pendingInvites.has(username)) {
          try {
            // await this.octokit.rest.orgs.createInvitation({
            //   org: this.orgName,
            //   username,
            // });
            syncResult.invited.push(username);
          } catch (e) {
            syncResult.errors.push(`Error inviting ${username}`);
            console.error('Error inviting user', e);
          }
        }
      }

      // remove users without GitHub usernames from the org
      for (const member of currentMembers) {
        if (
          !workspaceGitHubUsernames.has(member) &&
          !this.removeStopList.includes(member)
        ) {
          try {
            // await this.octokit.rest.orgs.removeMember({
            //   org: this.orgName,
            //   username: member,
            // });
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

  async getWorkspaceUsers(): Promise<GoogleUser[]> {
    const directory = google.admin({
      version: 'directory_v1',
      auth: this.auth,
    });

    try {
      const response = await directory.users.list({
        customer: 'my_customer',
        projection: 'full',
        viewType: 'domain_public',
      });

      return response.data.users || [];
    } catch (e) {
      console.error('Error fetching Google Workspace users', e);
      throw e;
    }
  }

  async getGithubMemberUsernames() {
    try {
      const members = await this.octokit.paginate(
        this.octokit.rest.orgs.listMembers,
        {
          org: this.orgName,
          per_page: 100,
        },
      );

      return new Set(members.map((member) => member.login.toLowerCase()));
    } catch (error) {
      console.error('Error fetching GitHub members', error);
      throw error;
    }
  }

  async getGithubInvitedUsers() {
    try {
      const invites = await this.octokit.paginate(
        this.octokit.rest.orgs.listPendingInvitations,
        {
          org: this.orgName,
          per_page: 100,
        },
      );

      return new Set(
        invites
          .filter((invite) => invite.login)
          .map((invite) => invite.login!.toLowerCase()),
      );
    } catch (error) {
      console.error('Error fetching GitHub invites', error);
      throw error;
    }
  }
}

const slackApp = new App({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  socketMode: true,
});

const sync = new WorkspaceGitHubSync();

slackApp.command('/sync-github', async ({ ack, respond }) => {
  console.debug('Received /sync-github command');
  await ack();

  try {
    const results = await sync.syncMembers();
    const formattedMessages = [
      ...results.invited.map(
        (username) =>
          `Invited: <https://github.com/orgs/code-store-platform/people/${username}|${username}>`,
      ),
      ...results.removed.map((username) => `Removed: ${username}`),
      ...results.errors.map((msg) => `Error: ${msg}`),
    ];

    const invitedMessageBlock = {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          '*Invited users:*\n' +
          results.invited
            .map(
              (username) =>
                `* <https://github.com/orgs/code-store-platform/people/${username}|${username}>`,
            )
            .join('\n'),
      },
    };
    const removedMessageBlock = {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          '*Removed users:*\n' +
          results.removed
            .map(
              (username) =>
                `* <https://github.com/orgs/code-store-platform/people/${username}|${username}>`,
            )
            .join('\n'),
      },
    };
    const errorsMessageBlock = {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          '*Errors:*\n' + results.errors.map((msg) => `* ${msg}`).join('\n'),
      },
    };

    const blocks = [];
    if (results.invited.length > 0) {
      blocks.push(invitedMessageBlock);
    }
    if (results.removed.length > 0) {
      blocks.push(removedMessageBlock);
    }
    if (results.errors.length > 0) {
      blocks.push(errorsMessageBlock);
    }
    await respond({
      text: 'Sync completed! Here are the results:',
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: 'Sync results',
          },
        },
        ...blocks,
        {
          type: 'divider',
        },
      ],
    });
  } catch (error) {
    await respond('Error during sync');
    console.error('Error during sync', error);
  }
});

await slackApp.start(process.env.PORT || 3000);
console.log('⚡️ Slack bot is running!');
