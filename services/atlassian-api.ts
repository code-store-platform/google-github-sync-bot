import { envVars } from "../lib/config.js";

export type AtlassianUser = {
  account_id: string;
  email: string;
  account_status: "active" | "inactive" | "closed";
  name?: string;
  added_to_org?: string; // ISO timestamp when user was added to organization
};

export type UserLastActiveData = {
  data: {
    product_access?: Array<{
      key: string; // Product key like "confluence", "jira-software"
      id: string; // Product ARI
      last_active: string; // Date string YYYY-MM-DD
      last_active_timestamp: string; // ISO timestamp
    }>;
    added_to_org?: string;
    added_to_org_timestamp?: string;
  };
  links: {
    next: string | null;
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
  private readonly baseUrl = "https://api.atlassian.com";
  private directoryId: string | null = null;

  constructor() {
    this.orgId = envVars.ATLASSIAN_ORG_ID;

    // Create Bearer token header for Atlassian Admin API
    this.authHeader = `Bearer ${envVars.ATLASSIAN_API_KEY}`;
  }

  /**
   * Fetches the directory ID for the organization.
   * Required for v2 API endpoints.
   */
  private async getDirectoryId(): Promise<string> {
    if (this.directoryId) {
      return this.directoryId;
    }

    const url = `${this.baseUrl}/admin/v2/orgs/${this.orgId}/directories`;

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: this.authHeader,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to fetch directories: ${response.status} ${errorText}`,
        );
      }

      const data: { data: { directoryId: string; name: string }[] } =
        await response.json();

      if (!data.data || data.data.length === 0) {
        throw new Error("No directories found for organization");
      }

      this.directoryId = data.data[0].directoryId;
      return this.directoryId;
    } catch (error) {
      console.error("Error fetching directory ID", error);
      throw error;
    }
  }

  /**
   * Fetches all users in the Atlassian organization with pagination support.
   * Uses v2 API with directory ID.
   */
  async getOrganizationUsers(): Promise<AtlassianUser[]> {
    const users: AtlassianUser[] = [];
    const directoryId = await this.getDirectoryId();
    let nextCursor: string | null = null;

    try {
      const baseApiUrl = `${this.baseUrl}/admin/v2/orgs/${this.orgId}/directories/${directoryId}/users`;

      do {
        // Build URL with cursor if we have one
        const url = nextCursor
          ? `${baseApiUrl}?cursor=${encodeURIComponent(nextCursor)}`
          : baseApiUrl;

        const response = await fetch(url, {
          method: "GET",
          headers: {
            Authorization: this.authHeader,
            "Content-Type": "application/json",
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `Failed to fetch Atlassian users: ${response.status} ${errorText}`,
          );
        }

        const data: any = await response.json();

        // Map v2 API response to our expected format
        const mappedUsers: AtlassianUser[] = data.data.map((user: any) => ({
          account_id: user.accountId,
          email: user.email,
          // In v2 API: accountStatus is "active" or "inactive", membershipStatus is "active" or "suspended"
          // We care about membershipStatus since that indicates if they have access to resources
          account_status:
            user.membershipStatus === "active" ? "active" : "inactive",
          name: user.name,
          added_to_org: user.addedToOrg,
        }));

        users.push(...mappedUsers);

        // Handle pagination - v2 API provides next cursor token
        nextCursor = data.links?.next || null;
      } while (nextCursor);

      console.log(`Fetched ${users.length} users from Atlassian API`);
      return users;
    } catch (error) {
      console.error("Error fetching Atlassian organization users", error);
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
        method: "GET",
        headers: {
          Authorization: this.authHeader,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to fetch last active data for ${accountId}: ${response.status} ${errorText}`,
        );
      }

      return await response.json();
    } catch (error) {
      console.error(
        `Error fetching last active data for user ${accountId}`,
        error,
      );
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
        method: "POST",
        headers: {
          Authorization: this.authHeader,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          message: "Suspended by automated license management system",
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to suspend user ${accountId}: ${response.status} ${errorText}`,
        );
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
        method: "POST",
        headers: {
          Authorization: this.authHeader,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to delete user ${accountId}: ${response.status} ${errorText}`,
        );
      }
    } catch (error) {
      console.error(`Error deleting user ${accountId}`, error);
      throw error;
    }
  }
}
