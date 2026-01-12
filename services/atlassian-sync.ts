import { envVars } from '../lib/config';
import { normalizeEmail } from '../lib/utils';
import { AtlassianApiClient, type AtlassianUser } from './atlassian-api';
import { createGoogleAuth, type GoogleUser, getWorkspaceUsers } from './google-workspace';

export type AtlassianSyncResult = {
  suspended: AtlassianResultUser[];
  errors: string[];
};

export type AtlassianInactivityResult = {
  suspended?: AtlassianResultUser[];
  deleted?: AtlassianResultUser[];
  errors: string[];
};

export type AtlassianResultUser = {
  email: string;
  accountId: string;
  lastActiveDate?: string;
  inactiveDays?: number;
};

type AtlassianProductAccess = {
  key: string;
  last_active_timestamp: string;
};

/**
 * WorkspaceAtlassianSync manages Atlassian user lifecycle based on Google Workspace status.
 *
 * Features:
 * - Suspends users not in Workspace (with configurable grace period)
 * - Suspends users inactive for >90 days
 * - Deletes users inactive for >180 days
 * - Respects stop list for protected accounts
 * - Supports dry-run mode for testing
 * - Caches user data within execution context to avoid redundant API calls
 *
 * Usage:
 *   const sync = new WorkspaceAtlassianSync();
 *   sync.clearCache(); // Clear before new execution
 *   await sync.syncSuspensions();
 *   await sync.check3MonthInactivity();
 *   await sync.check6MonthInactivity();
 *
 * Safety:
 * - Retry logic with exponential backoff (handled by AtlassianApiClient)
 * - No infinite loops: retries bounded to 3 max attempts per operation
 * - Per-user error handling: one failure doesn't block others
 * - Cache is execution-scoped: call clearCache() between CRON runs
 */
export class WorkspaceAtlassianSync {
  private readonly auth;
  private readonly api: AtlassianApiClient;
  private readonly suspendStopList: string[];
  private readonly dryRun: boolean;
  private readonly gracePeriodDays: number;

  // Inactivity thresholds
  private static readonly INACTIVITY_SUSPENSION_DAYS = 90;
  private static readonly INACTIVITY_DELETION_DAYS = 180;
  private static readonly RATE_LIMIT_DELAY_MS = 2000;

  // Cache TTL: 10 minutes
  private static readonly CACHE_TTL_MS = 10 * 60 * 1000;

  // Cache properties - null indicates not yet fetched
  private cachedWorkspaceUsers: GoogleUser[] | null = null;
  private cachedWorkspaceUsersTimestamp: number | null = null;

  private cachedAtlassianUsers: AtlassianUser[] | null = null;
  private cachedAtlassianUsersTimestamp: number | null = null;

  constructor() {
    this.auth = createGoogleAuth();
    this.api = new AtlassianApiClient();
    this.suspendStopList = envVars.ATLASSIAN_SUSPEND_STOP_LIST.map((email) =>
      normalizeEmail(email),
    );
    this.dryRun = envVars.ATLASSIAN_DRY_RUN || false;
    this.gracePeriodDays = envVars.ATLASSIAN_GRACE_PERIOD_DAYS;
  }

  /**
   * Checks if a user is within the grace period (recently added to organization).
   * Returns true if the user was added within the configured grace period.
   */
  private isWithinGracePeriod(addedToOrg?: string): boolean {
    if (!addedToOrg) {
      return false; // If no date available, don't apply grace period
    }

    const daysSinceAdded = this.calculateDaysSince(addedToOrg);

    return daysSinceAdded <= this.gracePeriodDays;
  }

  /**
   * Clears all cached data.
   * Call this between different execution contexts (e.g., between CRON runs).
   */
  clearCache(): void {
    this.cachedWorkspaceUsers = null;
    this.cachedWorkspaceUsersTimestamp = null;
    this.cachedAtlassianUsers = null;
    this.cachedAtlassianUsersTimestamp = null;
    console.log('Cache cleared manually');
  }

  /**
   * Checks if a cache timestamp is still valid based on TTL.
   * @param timestamp - The cache timestamp to check
   * @returns true if cache is valid, false if expired or null
   */
  private isCacheValid(timestamp: number | null): boolean {
    if (timestamp === null) return false;
    const age = Date.now() - timestamp;
    return age < WorkspaceAtlassianSync.CACHE_TTL_MS;
  }

  /**
   * Fetches workspace users with caching.
   * @param bypassCache - If true, force fresh fetch even if cached
   * @returns Array of Google Workspace users
   */
  private async getWorkspaceUsersWithCache(bypassCache = false): Promise<GoogleUser[]> {
    if (
      !bypassCache &&
      this.cachedWorkspaceUsers !== null &&
      this.isCacheValid(this.cachedWorkspaceUsersTimestamp)
    ) {
      const age = Math.floor((Date.now() - (this.cachedWorkspaceUsersTimestamp ?? 0)) / 1000);
      console.log(`Using cached workspace users (${this.cachedWorkspaceUsers.length} users, age: ${age}s)`);
      return this.cachedWorkspaceUsers;
    }

    console.log('Fetching workspace users from API (cache expired or bypassed)...');
    const users = await getWorkspaceUsers(this.auth);
    this.cachedWorkspaceUsers = users;
    this.cachedWorkspaceUsersTimestamp = Date.now();
    console.log(`Fetched and cached ${users.length} workspace users`);
    return users;
  }

  /**
   * Fetches Atlassian users with caching.
   * @param bypassCache - If true, force fresh fetch even if cached
   * @returns Array of Atlassian organization users
   */
  private async getAtlassianUsersWithCache(bypassCache = false): Promise<AtlassianUser[]> {
    if (
      !bypassCache &&
      this.cachedAtlassianUsers !== null &&
      this.isCacheValid(this.cachedAtlassianUsersTimestamp)
    ) {
      const age = Math.floor((Date.now() - (this.cachedAtlassianUsersTimestamp ?? 0)) / 1000);
      console.log(`Using cached Atlassian users (${this.cachedAtlassianUsers.length} users, age: ${age}s)`);
      return this.cachedAtlassianUsers;
    }

    console.log('Fetching Atlassian users from API (cache expired or bypassed)...');
    const users = await this.api.getOrganizationUsers();
    this.cachedAtlassianUsers = users;
    this.cachedAtlassianUsersTimestamp = Date.now();
    console.log(`Fetched and cached ${users.length} Atlassian users`);
    return users;
  }

  /**
   * Syncs Atlassian users with Google Workspace.
   * Suspends users who are in Atlassian but not in Workspace (unless in stop list).
   */
  async syncSuspensions(): Promise<AtlassianSyncResult> {
    const result: AtlassianSyncResult = { suspended: [], errors: [] };

    try {
      // Fetch Google Workspace users
      const workspaceUsers = await this.getWorkspaceUsersWithCache();
      const workspaceEmails = new Set(
        workspaceUsers.map((user) => normalizeEmail(user.primaryEmail || '')),
      );

      // Fetch Atlassian users
      const atlassianUsers = await this.getAtlassianUsersWithCache();

      // Find users to suspend: in Atlassian but not in Workspace, not in stop list, and past grace period
      const usersToSuspend = atlassianUsers.filter((user) => {
        const normalizedEmail = normalizeEmail(user.email);

        // Skip if active and in Workspace
        if (user.account_status !== 'active' || workspaceEmails.has(normalizedEmail)) {
          return false;
        }

        // Skip if in stop list
        if (this.suspendStopList.includes(normalizedEmail)) {
          return false;
        }

        // Skip if within grace period
        if (this.isWithinGracePeriod(user.added_to_org)) {
          const daysSinceAdded = this.calculateDaysSince(user.added_to_org!);
          console.log(
            `Skipping ${user.email} - within grace period (added ${daysSinceAdded} days ago, grace period: ${this.gracePeriodDays} days)`,
          );
          return false;
        }

        return true;
      });

      // Suspend each user
      for (const user of usersToSuspend) {
        try {
          if (this.dryRun) {
            console.log(`[DRY RUN] Would suspend user: ${user.email} (${user.account_id})`);
          } else {
            await this.api.suspendUser(user.account_id);
          }
          result.suspended.push({
            email: user.email,
            accountId: user.account_id,
          });
        } catch (e) {
          result.errors.push(
            `Failed to suspend ${user.email} (${user.account_id}): ${
              e instanceof Error ? e.message : 'Unknown error'
            }`,
          );
          console.error('Error suspending user', e);
        }
      }
    } catch (e) {
      console.error('Error during Atlassian suspension sync', e);
      throw e;
    }

    return result;
  }

  /**
   * Checks for users inactive for more than 3 months (90 days) and suspends them.
   * Only checks active users who are NOT in Google Workspace.
   */
  async check3MonthInactivity(): Promise<AtlassianInactivityResult> {
    const result: AtlassianInactivityResult = { suspended: [], errors: [] };

    try {
      // Fetch Google Workspace users
      const workspaceUsers = await this.getWorkspaceUsersWithCache();
      const workspaceEmails = new Set(
        workspaceUsers.map((user) => normalizeEmail(user.primaryEmail || '')),
      );

      // Fetch all active Atlassian users
      const atlassianUsers = await this.getAtlassianUsersWithCache();
      const activeUsers = atlassianUsers.filter((user) => user.account_status === 'active');

      // Check each active user's last activity
      for (const user of activeUsers) {
        const normalizedEmail = normalizeEmail(user.email);

        // Skip users in stop list
        if (this.suspendStopList.includes(normalizedEmail)) {
          continue;
        }

        // Skip users who are still in Google Workspace
        if (workspaceEmails.has(normalizedEmail)) {
          console.log(`Skipping ${user.email} - still in Google Workspace`);
          continue;
        }

        try {
          const lastActiveData = await this.api.getUserLastActive(user.account_id);

          // Rate limit to avoid hitting API limits
          await this.rateLimit();

          // Skip if no activity data (new user)
          if (
            !lastActiveData.data.product_access ||
            lastActiveData.data.product_access.length === 0
          ) {
            console.log(`Skipping ${user.email} - no activity data available`);
            continue;
          }

          // Find most recent activity across all products
          const mostRecentActivity = this.getMostRecentActivity(lastActiveData.data.product_access);

          if (!mostRecentActivity) {
            console.log(`Skipping ${user.email} - no valid activity dates`);
            continue;
          }

          const daysSinceLastActive = this.calculateDaysSince(mostRecentActivity);

          // Suspend if inactive for more than 90 days
          if (daysSinceLastActive > WorkspaceAtlassianSync.INACTIVITY_SUSPENSION_DAYS) {
            if (this.dryRun) {
              console.log(
                `[DRY RUN] Would suspend user: ${user.email} (${user.account_id}) - inactive for ${daysSinceLastActive} days`,
              );
            } else {
              await this.api.suspendUser(user.account_id);
            }
            result.suspended!.push({
              email: user.email,
              accountId: user.account_id,
              lastActiveDate: mostRecentActivity,
              inactiveDays: daysSinceLastActive,
            });
          }
        } catch (e) {
          result.errors.push(
            `Failed to check inactivity for ${user.email} (${user.account_id}): ${
              e instanceof Error ? e.message : 'Unknown error'
            }`,
          );
          console.error(`Error checking inactivity for user ${user.email}`, e);
        }
      }
    } catch (e) {
      console.error('Error during 3-month inactivity check', e);
      throw e;
    }

    return result;
  }

  /**
   * Checks for users inactive for more than 6 months (180 days) and deletes them.
   * Only checks suspended/inactive users who are NOT in Google Workspace.
   */
  async check6MonthInactivity(): Promise<AtlassianInactivityResult> {
    const result: AtlassianInactivityResult = { deleted: [], errors: [] };

    try {
      // Fetch Google Workspace users
      const workspaceUsers = await this.getWorkspaceUsersWithCache();
      const workspaceEmails = new Set(
        workspaceUsers.map((user) => normalizeEmail(user.primaryEmail || '')),
      );

      // Fetch all suspended/inactive Atlassian users
      const atlassianUsers = await this.getAtlassianUsersWithCache();
      const suspendedUsers = atlassianUsers.filter((user) => user.account_status === 'inactive');

      // Check each suspended user's last activity
      for (const user of suspendedUsers) {
        const normalizedEmail = normalizeEmail(user.email);

        // Skip users in stop list
        if (this.suspendStopList.includes(normalizedEmail)) {
          continue;
        }

        // Skip users who are still in Google Workspace
        if (workspaceEmails.has(normalizedEmail)) {
          console.log(`Skipping ${user.email} - still in Google Workspace`);
          continue;
        }

        try {
          const lastActiveData = await this.api.getUserLastActive(user.account_id);

          // Rate limit to avoid hitting API limits
          await this.rateLimit();

          // Skip if no activity data
          if (
            !lastActiveData.data.product_access ||
            lastActiveData.data.product_access.length === 0
          ) {
            console.log(`Skipping ${user.email} - no activity data available`);
            continue;
          }

          // Find most recent activity across all products
          const mostRecentActivity = this.getMostRecentActivity(lastActiveData.data.product_access);

          if (!mostRecentActivity) {
            console.log(`Skipping ${user.email} - no valid activity dates`);
            continue;
          }

          const daysSinceLastActive = this.calculateDaysSince(mostRecentActivity);

          // Delete if inactive for more than 180 days
          if (daysSinceLastActive > WorkspaceAtlassianSync.INACTIVITY_DELETION_DAYS) {
            if (this.dryRun) {
              console.log(
                `[DRY RUN] Would delete user: ${user.email} (${user.account_id}) - inactive for ${daysSinceLastActive} days`,
              );
            } else {
              await this.api.deleteUser(user.account_id);
            }
            result.deleted!.push({
              email: user.email,
              accountId: user.account_id,
              lastActiveDate: mostRecentActivity,
              inactiveDays: daysSinceLastActive,
            });
          }
        } catch (e) {
          result.errors.push(
            `Failed to check inactivity for ${user.email} (${user.account_id}): ${
              e instanceof Error ? e.message : 'Unknown error'
            }`,
          );
          console.error(`Error checking inactivity for user ${user.email}`, e);
        }
      }
    } catch (e) {
      console.error('Error during 6-month inactivity check', e);
      throw e;
    }

    return result;
  }

  /**
   * Finds the most recent activity date across all Atlassian products.
   * Returns ISO date string or null if no valid dates found.
   */
  private getMostRecentActivity(productAccess: AtlassianProductAccess[]): string | null {
    if (!productAccess || productAccess.length === 0) {
      return null;
    }

    // Get all valid timestamps and convert to Date objects
    const dates = productAccess
      .map((product) => product.last_active_timestamp)
      .filter((timestamp) => timestamp && timestamp !== '')
      .map((timestamp) => new Date(timestamp));

    if (dates.length === 0) {
      return null;
    }

    // Find the maximum (most recent) date
    const mostRecent = new Date(Math.max(...dates.map((date) => date.getTime())));
    return mostRecent.toISOString();
  }

  /**
   * Calculates the number of days between a given date and now.
   */
  private calculateDaysSince(isoDate: string): number {
    const pastDate = new Date(isoDate);
    const now = new Date();
    const diffMs = now.getTime() - pastDate.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  /**
   * Delays execution to avoid hitting rate limits.
   * Uses 2 second delay to stay well under Atlassian's rate limits.
   */
  private async rateLimit(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, WorkspaceAtlassianSync.RATE_LIMIT_DELAY_MS));
  }
}
