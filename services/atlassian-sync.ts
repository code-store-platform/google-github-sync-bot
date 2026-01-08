import { envVars } from '../lib/config.js';
import { normalizeEmail } from '../lib/utils.js';
import { AtlassianApiClient } from './atlassian-api.js';
import { createGoogleAuth, getWorkspaceUsers } from './google-workspace.js';

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

export class WorkspaceAtlassianSync {
  private readonly auth;
  private readonly api: AtlassianApiClient;
  private readonly suspendStopList: string[];
  private readonly dryRun: boolean;

  constructor() {
    this.auth = createGoogleAuth();
    this.api = new AtlassianApiClient();
    this.suspendStopList = envVars.ATLASSIAN_SUSPEND_STOP_LIST.map((email) =>
      normalizeEmail(email),
    );
    this.dryRun = envVars.ATLASSIAN_DRY_RUN || false;
  }

  /**
   * Syncs Atlassian users with Google Workspace.
   * Suspends users who are in Atlassian but not in Workspace (unless in stop list).
   */
  async syncSuspensions(): Promise<AtlassianSyncResult> {
    const result: AtlassianSyncResult = { suspended: [], errors: [] };

    try {
      // Fetch Google Workspace users
      const workspaceUsers = await getWorkspaceUsers(this.auth);
      const workspaceEmails = new Set(
        workspaceUsers.map((user) => normalizeEmail(user.primaryEmail || '')),
      );

      // Fetch Atlassian users
      const atlassianUsers = await this.api.getOrganizationUsers();

      // Find users to suspend: in Atlassian but not in Workspace and not in stop list
      const usersToSuspend = atlassianUsers.filter((user) => {
        const normalizedEmail = normalizeEmail(user.email);
        return (
          user.account_status === 'active' &&
          !workspaceEmails.has(normalizedEmail) &&
          !this.suspendStopList.includes(normalizedEmail)
        );
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
          result.errors.push(`Error suspending ${user.email}`);
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
   * Only checks active users.
   */
  async check3MonthInactivity(): Promise<AtlassianInactivityResult> {
    const result: AtlassianInactivityResult = { suspended: [], errors: [] };

    try {
      // Fetch all active Atlassian users
      const atlassianUsers = await this.api.getOrganizationUsers();
      const activeUsers = atlassianUsers.filter((user) => user.account_status === 'active');

      // Check each active user's last activity
      for (const user of activeUsers) {
        const normalizedEmail = normalizeEmail(user.email);

        // Skip users in stop list
        if (this.suspendStopList.includes(normalizedEmail)) {
          continue;
        }

        try {
          const lastActiveData = await this.api.getUserLastActive(user.account_id);

          // Skip if no activity data (new user)
          if (
            !lastActiveData.last_active_dates ||
            Object.keys(lastActiveData.last_active_dates).length === 0
          ) {
            console.log(`Skipping ${user.email} - no activity data available`);
            continue;
          }

          // Find most recent activity across all products
          const mostRecentActivity = this.getMostRecentActivity(lastActiveData.last_active_dates);

          if (!mostRecentActivity) {
            console.log(`Skipping ${user.email} - no valid activity dates`);
            continue;
          }

          const daysSinceLastActive = this.calculateDaysSince(mostRecentActivity);

          // Suspend if inactive for more than 90 days
          if (daysSinceLastActive > 90) {
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
          result.errors.push(`Error checking inactivity for ${user.email}`);
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
   * Only checks suspended/inactive users.
   */
  async check6MonthInactivity(): Promise<AtlassianInactivityResult> {
    const result: AtlassianInactivityResult = { deleted: [], errors: [] };

    try {
      // Fetch all suspended/inactive Atlassian users
      const atlassianUsers = await this.api.getOrganizationUsers();
      const suspendedUsers = atlassianUsers.filter((user) => user.account_status === 'inactive');

      // Check each suspended user's last activity
      for (const user of suspendedUsers) {
        const normalizedEmail = normalizeEmail(user.email);

        // Skip users in stop list
        if (this.suspendStopList.includes(normalizedEmail)) {
          continue;
        }

        try {
          const lastActiveData = await this.api.getUserLastActive(user.account_id);

          // Skip if no activity data
          if (
            !lastActiveData.last_active_dates ||
            Object.keys(lastActiveData.last_active_dates).length === 0
          ) {
            console.log(`Skipping ${user.email} - no activity data available`);
            continue;
          }

          // Find most recent activity across all products
          const mostRecentActivity = this.getMostRecentActivity(lastActiveData.last_active_dates);

          if (!mostRecentActivity) {
            console.log(`Skipping ${user.email} - no valid activity dates`);
            continue;
          }

          const daysSinceLastActive = this.calculateDaysSince(mostRecentActivity);

          // Delete if inactive for more than 180 days
          if (daysSinceLastActive > 180) {
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
          result.errors.push(`Error checking inactivity for ${user.email}`);
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
  private getMostRecentActivity(lastActiveDates: { [product: string]: string }): string | null {
    const dates = Object.values(lastActiveDates)
      .filter((date) => date && date !== '')
      .map((date) => new Date(date));

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
}
