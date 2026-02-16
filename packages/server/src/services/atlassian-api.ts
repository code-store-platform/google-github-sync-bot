import { envVars } from '../lib/config';

export type AtlassianUser = {
  account_id: string;
  email: string;
  account_status: 'active' | 'inactive' | 'closed';
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

export class AtlassianApiClient {
  private readonly orgId: string;
  private readonly authHeader: string;
  private readonly baseUrl = 'https://api.atlassian.com';
  private directoryId: string | null = null;

  constructor() {
    this.orgId = envVars.ATLASSIAN_ORG_ID;

    // Create Bearer token header for Atlassian Admin API
    this.authHeader = `Bearer ${envVars.ATLASSIAN_API_KEY}`;
  }

  /**
   * Executes an API operation with exponential backoff retry logic.
   * Retries up to 3 times with delays: 1s, 2s, 4s (max total: ~7 seconds)
   *
   * @param operation - Async function to execute
   * @param operationName - Name for logging purposes
   * @returns Result of the operation
   * @throws Error if all retries are exhausted
   */
  private async withRetry<T>(operation: () => Promise<T>, operationName: string): Promise<T> {
    const MAX_RETRIES = 3;
    const BASE_DELAY_MS = 1000; // 1 second

    let lastError: Error | undefined;

    // Loop is bounded: attempt goes from 0 to MAX_RETRIES (inclusive)
    // Total attempts: 4 (initial + 3 retries)
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        // Check if this is the last attempt
        if (attempt === MAX_RETRIES) {
          console.error(`${operationName} failed after ${MAX_RETRIES} retries`, error);
          throw error;
        }

        // Check if error is retryable (rate limit, timeout, connection errors)
        const errorMsg = error instanceof Error ? error.message : String(error);
        const isRetryable =
          errorMsg.includes('429') ||
          errorMsg.includes('rate limit') ||
          errorMsg.includes('timeout') ||
          errorMsg.includes('ECONNRESET') ||
          errorMsg.includes('ETIMEDOUT');

        if (!isRetryable) {
          console.error(`${operationName} failed with non-retryable error`, error);
          throw error;
        }

        // Calculate exponential backoff delay: 1s, 2s, 4s
        const delayMs = BASE_DELAY_MS * 2 ** attempt;

        // Wait before retry
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    // TypeScript requires this, but it's unreachable due to throw in loop
    throw lastError || new Error(`${operationName} failed after retries`);
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
        method: 'GET',
        headers: {
          Authorization: this.authHeader,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch directories: ${response.status} ${errorText}`);
      }

      const data: { data: { directoryId: string; name: string }[] } = await response.json();

      if (!data.data || data.data.length === 0) {
        throw new Error('No directories found for organization');
      }

      this.directoryId = data.data[0].directoryId;
      return this.directoryId;
    } catch (error) {
      console.error('Error fetching directory ID', error);
      throw error;
    }
  }

  /**
   * Fetches all users in the Atlassian organization with pagination support.
   * Uses v2 API with directory ID.
   *
   * NOTE: This method does NOT use withRetry wrapper to avoid amplifying rate limit errors.
   * When a 429 rate limit is hit, it's better to fail fast and let the cache + CRON handle it
   * rather than retrying and making even more API calls.
   */
  async getOrganizationUsers(): Promise<AtlassianUser[]> {
    const users: AtlassianUser[] = [];
    const directoryId = await this.getDirectoryId();
    let nextCursor: string | null = null;

    const MAX_PAGES = 100; // Safety limit to prevent infinite loops
    let pageCount = 0;
    const seenUrls = new Set<string>(); // Track visited URLs to detect loops

    try {
      const baseApiUrl = `${this.baseUrl}/admin/v2/orgs/${this.orgId}/directories/${directoryId}/users`;

      do {
        // Safety checks
        if (pageCount >= MAX_PAGES) {
          console.error(
            `Reached maximum page limit (${MAX_PAGES}) while fetching Atlassian users. Fetched ${users.length} users so far.`,
          );
          break;
        }

        // Build URL with cursor if we have one
        const url = nextCursor
          ? `${baseApiUrl}?cursor=${encodeURIComponent(nextCursor)}`
          : baseApiUrl;

        // Detect infinite loop - same URL fetched twice
        if (seenUrls.has(url)) {
          console.error(`Infinite loop detected: attempting to fetch same URL twice: ${url}`);
          break;
        }
        seenUrls.add(url);

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
          // If we hit rate limit, log it and stop (don't retry)
          if (response.status === 429) {
            console.error(
              `Rate limit hit while fetching Atlassian users (page ${pageCount + 1}). Returning ${users.length} users fetched so far.`,
            );
            break;
          }
          throw new Error(`Failed to fetch Atlassian users: ${response.status} ${errorText}`);
        }

        type UserResponse = {
          accountId: string;
          email: string;
          membershipStatus: string;
          name?: string;
          addedToOrg?: string;
        };

        type ApiResponse = {
          data: UserResponse[];
          links?: { next?: string };
        };

        const data: ApiResponse = await response.json();

        // Map v2 API response to our expected format
        const mappedUsers: AtlassianUser[] = data.data.map((user: UserResponse) => ({
          account_id: user.accountId,
          email: user.email,
          // In v2 API: accountStatus is "active" or "inactive", membershipStatus is "active" or "suspended"
          // We care about membershipStatus since that indicates if they have access to resources
          account_status: user.membershipStatus === 'active' ? 'active' : 'inactive',
          name: user.name,
          added_to_org: user.addedToOrg,
        }));

        users.push(...mappedUsers);
        pageCount++;

        // Handle pagination - check if next is a full URL or cursor token
        const nextLink = data.links?.next;
        if (!nextLink) {
          nextCursor = null;
        } else if (nextLink.startsWith('http://') || nextLink.startsWith('https://')) {
          // Full URL returned - extract cursor parameter
          try {
            const nextUrl = new URL(nextLink);
            nextCursor = nextUrl.searchParams.get('cursor');
          } catch (e) {
            console.error(`Failed to parse next URL: ${nextLink}`, e);
            nextCursor = null;
          }
        } else {
          // Assume it's a cursor token
          nextCursor = nextLink;
        }
      } while (nextCursor);

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
    return this.withRetry(async () => {
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
          throw new Error(
            `Failed to fetch last active data for ${accountId}: ${response.status} ${errorText}`,
          );
        }

        const data: UserLastActiveData = await response.json();
        return data;
      } catch (error) {
        console.error(`Error fetching last active data for user ${accountId}`, error);
        throw error;
      }
    }, `getUserLastActive(${accountId})`);
  }

  /**
   * Suspends a user's access to all Atlassian products in the organization.
   * User loses access but retains roles/groups for potential restoration.
   */
  async suspendUser(accountId: string): Promise<void> {
    return this.withRetry(async () => {
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
    }, `suspendUser(${accountId})`);
  }

  /**
   * Permanently deletes a user's account.
   * Note: There is a 14-day grace period where the account appears temporarily deactivated
   * before permanent deletion completes.
   */
  async deleteUser(accountId: string): Promise<void> {
    return this.withRetry(async () => {
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
    }, `deleteUser(${accountId})`);
  }
}
