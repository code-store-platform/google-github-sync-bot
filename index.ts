import {google } from 'googleapis';
import * as dotenv from 'dotenv';

dotenv.config();

type GoogleUser = {
  primaryEmail?: string | null;
  customSchemas?: {
    '3rd-party_tools'?: {
      GitHub_Username?: string;
    } | null;
  } | null;
}

class WorkspaceGitHubSync {
  private readonly auth;

  constructor() {
    this.auth = new google.auth.GoogleAuth({
      keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      scopes: ['https://www.googleapis.com/auth/admin.directory.user.readonly'],
      clientOptions: {
        subject: process.env.GOOGLE_ADMIN_EMAIL, // impersonate the admin user
      }
    });
  }

  async syncMembers() {
    try {
      const workspaceUsers = await this.getWorkspaceUsers();

      // get all users with GitHub usernames
      const workspaceGitHubUsers = new Set(
        workspaceUsers
          .filter(user => !!user.customSchemas && user.customSchemas["3rd-party_tools"]?.GitHub_Username)
          .map(user => user.customSchemas!["3rd-party_tools"]!.GitHub_Username!)
      );
    }
    catch (e) {
      console.error('Error during synchronization', e);
      throw e;
    }
  }

  async getWorkspaceUsers(): Promise<GoogleUser[]> {
    const directory = google.admin({ version: 'directory_v1', auth: this.auth });

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
}

async function main() {
  const sync = new WorkspaceGitHubSync();
  await sync.syncMembers();
}

main().catch(console.error);
