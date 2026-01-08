import { envVars } from '../lib/config.js';

export type AtlassianUser = {
  account_id: string;
  email: string;
  account_status: 'active' | 'inactive' | 'closed';
  name?: string;
};

export type UserLastActiveData = {
  account_id: string;
  last_active_dates?: {
    [product: string]: string; // ISO date string
  };
};

type AtlassianUsersResponse = {
  data: AtlassianUser[];
  links?: {
    next?: string;
  };
};

export class AtlassianApiClient {
  private readonly orgId: string;
  private readonly authHeader: string;
  private readonly baseUrl = 'https://api.atlassian.com';

  constructor() {
    this.orgId = envVars.ATLASSIAN_ORG_ID;

    // Create Basic Auth header: base64(email:api_key)
    const credentials = `${envVars.ATLASSIAN_ADMIN_EMAIL}:${envVars.ATLASSIAN_API_KEY}`;
    this.authHeader = `Basic ${Buffer.from(credentials).toString('base64')}`;
  }

  /**
   * Fetches all users in the Atlassian organization with pagination support.
   */
  async getOrganizationUsers(): Promise<AtlassianUser[]> {
    const users: AtlassianUser[] = [];
    let url: string | null = `${this.baseUrl}/admin/v1/orgs/${this.orgId}/users`;

    try {
      while (url) {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: this.authHeader,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to fetch Atlassian users: ${response.status} ${errorText}`);
        }

        const data: AtlassianUsersResponse = await response.json();
        users.push(...data.data);

        // Handle pagination
        url = data.links?.next || null;
      }

      return users;
    } catch (error) {
      console.error('Error fetching Atlassian organization users', error);
      throw error;
    }
  }

  /**
   * Fetches the last active dates for a specific user across all Atlassian products.
   * Returns undefined for last_active_dates if user has no activity data yet.
   */
  async getUserLastActive(accountId: string): Promise<UserLastActiveData> {
    const url = `${this.baseUrl}/admin/v1/orgs/${this.orgId}/directory/users/${accountId}/last-active-dates`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch last active data for ${accountId}: ${response.status} ${errorText}`);
      }

      return await response.json();
    } catch (error) {
      console.error(`Error fetching last active data for user ${accountId}`, error);
      throw error;
    }
  }

  /**
   * Suspends a user's access to all Atlassian products in the organization.
   * User loses access but retains roles/groups for potential restoration.
   */
  async suspendUser(accountId: string): Promise<void> {
    const url = `${this.baseUrl}/admin/v1/orgs/${this.orgId}/directory/users/${accountId}/suspend-access`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          message: 'Suspended by automated license management system',
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to suspend user ${accountId}: ${response.status} ${errorText}`);
      }
    } catch (error) {
      console.error(`Error suspending user ${accountId}`, error);
      throw error;
    }
  }

  /**
   * Permanently deletes a user's account.
   * Note: There is a 14-day grace period where the account appears temporarily deactivated
   * before permanent deletion completes.
   */
  async deleteUser(accountId: string): Promise<void> {
    const url = `${this.baseUrl}/users/${accountId}/manage/lifecycle/delete`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to delete user ${accountId}: ${response.status} ${errorText}`);
      }
    } catch (error) {
      console.error(`Error deleting user ${accountId}`, error);
      throw error;
    }
  }
}
