import { normalizeEmail } from '@google-github-sync/shared/utils';
import { envVars } from '../../lib/config';
import { AtlassianApiClient, type AtlassianUser } from './api-client';
import type { GoogleUser } from '../google-workspace';

export type AtlassianSyncResult = {
  suspended: { email: string; accountId: string }[];
  errors: string[];
};

export type AtlassianInactivityResult = {
  suspended?: { email: string; accountId: string; lastActiveDate?: string; inactiveDays?: number }[];
  deleted?: { email: string; accountId: string; lastActiveDate?: string; inactiveDays?: number }[];
  errors: string[];
};

export class WorkspaceAtlassianSync {
  private readonly api: AtlassianApiClient;
  private readonly suspendStopList: string[];
  private readonly dryRun: boolean;

  private static readonly INACTIVITY_SUSPENSION_DAYS = 90;
  private static readonly INACTIVITY_DELETION_DAYS = 180;
  private static readonly RATE_LIMIT_DELAY_MS = 2000;
  private static readonly CACHE_TTL_MS = 10 * 60 * 1000;

  private cachedAtlassianUsers: AtlassianUser[] | null = null;
  private cachedAtlassianUsersTimestamp: number | null = null;

  constructor() {
    this.api = new AtlassianApiClient();
    this.suspendStopList = envVars.ATLASSIAN_SUSPEND_STOP_LIST.map((email) =>
      normalizeEmail(email),
    );
    this.dryRun = envVars.ATLASSIAN_DRY_RUN || false;
  }

  clearCache(): void {
    this.cachedAtlassianUsers = null;
    this.cachedAtlassianUsersTimestamp = null;
  }

  private isCacheValid(timestamp: number | null): boolean {
    if (timestamp === null) return false;
    return Date.now() - timestamp < WorkspaceAtlassianSync.CACHE_TTL_MS;
  }

  private async getAtlassianUsersWithCache(bypassCache = false): Promise<AtlassianUser[]> {
    if (
      !bypassCache &&
      this.cachedAtlassianUsers !== null &&
      this.isCacheValid(this.cachedAtlassianUsersTimestamp)
    ) {
      return this.cachedAtlassianUsers;
    }

    const users = await this.api.getOrganizationUsers();
    this.cachedAtlassianUsers = users;
    this.cachedAtlassianUsersTimestamp = Date.now();
    return users;
  }

  async syncSuspensions(workspaceUsers: GoogleUser[]): Promise<AtlassianSyncResult> {
    const result: AtlassianSyncResult = { suspended: [], errors: [] };

    const workspaceEmails = new Set(
      workspaceUsers.map((user) => normalizeEmail(user.primaryEmail || '')),
    );

    const atlassianUsers = await this.getAtlassianUsersWithCache();

    const usersToSuspend = atlassianUsers.filter((user) => {
      const normalizedEmail = normalizeEmail(user.email);
      if (!normalizedEmail.endsWith('@code.store')) return false;
      if (user.account_status !== 'active' || workspaceEmails.has(normalizedEmail)) return false;
      if (this.suspendStopList.includes(normalizedEmail)) return false;
      return true;
    });

    for (const user of usersToSuspend) {
      try {
        if (!this.dryRun) {
          await this.api.suspendUser(user.account_id);
        }
        result.suspended.push({ email: user.email, accountId: user.account_id });
      } catch (e) {
        result.errors.push(
          `Failed to suspend ${user.email}: ${e instanceof Error ? e.message : 'Unknown error'}`,
        );
      }
    }

    return result;
  }

  async check3MonthInactivity(
    workspaceUsers: GoogleUser[],
  ): Promise<AtlassianInactivityResult> {
    return this.checkInactivity(
      workspaceUsers,
      WorkspaceAtlassianSync.INACTIVITY_SUSPENSION_DAYS,
      'active',
      'suspend',
    );
  }

  async check6MonthInactivity(
    workspaceUsers: GoogleUser[],
  ): Promise<AtlassianInactivityResult> {
    return this.checkInactivity(
      workspaceUsers,
      WorkspaceAtlassianSync.INACTIVITY_DELETION_DAYS,
      'inactive',
      'delete',
    );
  }

  private async checkInactivity(
    workspaceUsers: GoogleUser[],
    thresholdDays: number,
    statusFilter: 'active' | 'inactive',
    action: 'suspend' | 'delete',
  ): Promise<AtlassianInactivityResult> {
    const result: AtlassianInactivityResult = {
      ...(action === 'suspend' ? { suspended: [] } : { deleted: [] }),
      errors: [],
    };

    const workspaceEmails = new Set(
      workspaceUsers.map((user) => normalizeEmail(user.primaryEmail || '')),
    );

    const atlassianUsers = await this.getAtlassianUsersWithCache();

    const filteredUsers = atlassianUsers.filter((user) => {
      if (statusFilter === 'active') return user.account_status === 'active';
      return user.account_status !== 'active';
    });

    for (const user of filteredUsers) {
      const normalizedEmail = normalizeEmail(user.email);
      if (this.suspendStopList.includes(normalizedEmail)) continue;
      if (workspaceEmails.has(normalizedEmail)) continue;

      try {
        const lastActiveData = await this.api.getUserLastActive(user.account_id);
        await new Promise((resolve) =>
          setTimeout(resolve, WorkspaceAtlassianSync.RATE_LIMIT_DELAY_MS),
        );

        if (
          !lastActiveData.data.product_access ||
          lastActiveData.data.product_access.length === 0
        ) {
          continue;
        }

        const dates = lastActiveData.data.product_access
          .map((p) => p.last_active_timestamp)
          .filter((t) => t && t !== '')
          .map((t) => new Date(t));

        if (dates.length === 0) continue;

        const mostRecent = new Date(Math.max(...dates.map((d) => d.getTime())));
        const daysSince = Math.floor(
          (Date.now() - mostRecent.getTime()) / (1000 * 60 * 60 * 24),
        );

        if (daysSince > thresholdDays) {
          const entry = {
            email: user.email,
            accountId: user.account_id,
            lastActiveDate: mostRecent.toISOString(),
            inactiveDays: daysSince,
          };

          if (action === 'suspend') {
            if (!this.dryRun) await this.api.suspendUser(user.account_id);
            result.suspended?.push(entry);
          } else {
            if (!this.dryRun) await this.api.deleteUser(user.account_id);
            result.deleted?.push(entry);
          }
        }
      } catch (e) {
        result.errors.push(
          `Error checking ${user.email}: ${e instanceof Error ? e.message : 'Unknown error'}`,
        );
      }
    }

    return result;
  }
}
