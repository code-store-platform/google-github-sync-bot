import { envVars } from '../../lib/config';

export type AtlassianUser = {
  account_id: string;
  email: string;
  account_status: 'active' | 'inactive' | 'closed';
  name?: string;
  added_to_org?: string;
};

export type UserLastActiveData = {
  data: {
    product_access?: Array<{
      key: string;
      id: string;
      last_active: string;
      last_active_timestamp: string;
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
    this.orgId = envVars.ATLASSIAN_ORG_ID ?? '';
    this.authHeader = `Bearer ${envVars.ATLASSIAN_API_KEY ?? ''}`;
  }

  private async withRetry<T>(operation: () => Promise<T>, operationName: string): Promise<T> {
    const MAX_RETRIES = 3;
    const BASE_DELAY_MS = 1000;

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        if (attempt === MAX_RETRIES) {
          console.error(`${operationName} failed after ${MAX_RETRIES} retries`, error);
          throw error;
        }

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

        const delayMs = BASE_DELAY_MS * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw lastError || new Error(`${operationName} failed after retries`);
  }

  private async getDirectoryId(): Promise<string> {
    if (this.directoryId) return this.directoryId;

    const url = `${this.baseUrl}/admin/v2/orgs/${this.orgId}/directories`;

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
  }

  async getOrganizationUsers(): Promise<AtlassianUser[]> {
    const users: AtlassianUser[] = [];
    const directoryId = await this.getDirectoryId();
    let nextCursor: string | null = null;

    const MAX_PAGES = 100;
    let pageCount = 0;
    const seenUrls = new Set<string>();

    const baseApiUrl = `${this.baseUrl}/admin/v2/orgs/${this.orgId}/directories/${directoryId}/users`;

    do {
      if (pageCount >= MAX_PAGES) break;

      const url = nextCursor
        ? `${baseApiUrl}?cursor=${encodeURIComponent(nextCursor)}`
        : baseApiUrl;

      if (seenUrls.has(url)) break;
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
        if (response.status === 429) break;
        const errorText = await response.text();
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

      const mappedUsers: AtlassianUser[] = data.data.map((user: UserResponse) => ({
        account_id: user.accountId,
        email: user.email,
        account_status: user.membershipStatus === 'active' ? 'active' : 'inactive',
        name: user.name,
        added_to_org: user.addedToOrg,
      }));

      users.push(...mappedUsers);
      pageCount++;

      const nextLink = data.links?.next;
      if (!nextLink) {
        nextCursor = null;
      } else if (nextLink.startsWith('http://') || nextLink.startsWith('https://')) {
        try {
          const nextUrl = new URL(nextLink);
          nextCursor = nextUrl.searchParams.get('cursor');
        } catch {
          nextCursor = null;
        }
      } else {
        nextCursor = nextLink;
      }
    } while (nextCursor);

    return users;
  }

  async getUserLastActive(accountId: string): Promise<UserLastActiveData> {
    return this.withRetry(async () => {
      const url = `${this.baseUrl}/admin/v1/orgs/${this.orgId}/directory/users/${accountId}/last-active-dates`;

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

      return await response.json();
    }, `getUserLastActive(${accountId})`);
  }

  async suspendUser(accountId: string): Promise<void> {
    return this.withRetry(async () => {
      const url = `${this.baseUrl}/admin/v1/orgs/${this.orgId}/directory/users/${accountId}/suspend-access`;

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
    }, `suspendUser(${accountId})`);
  }

  async deleteUser(accountId: string): Promise<void> {
    return this.withRetry(async () => {
      const url = `${this.baseUrl}/users/${accountId}/manage/lifecycle/delete`;

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
    }, `deleteUser(${accountId})`);
  }
}
