import { type ActivityEntry, DashboardApi } from '@google-github-sync/shared/api';
import { auditLog, syncHistory } from '@google-github-sync/shared/db/schema';
import { desc, sql } from 'drizzle-orm';
import { Effect } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { db } from '../db';
import { dbQuery } from '../lib/effect';

function formatSyncSummary(row: typeof syncHistory.$inferSelect): string {
  const parts = [];
  if (row.invitedCount > 0) parts.push(`${row.invitedCount} invited`);
  if (row.removedCount > 0) parts.push(`${row.removedCount} removed`);
  if (row.errorCount > 0) parts.push(`${row.errorCount} errors`);
  if (parts.length === 0) parts.push('no changes');
  return `GitHub sync: ${parts.join(', ')}`;
}

const ACTION_LABELS: Record<
  string,
  (entityId: string, payload: Record<string, unknown>) => string
> = {
  update_github_username: (id, p) =>
    `Updated GitHub username for ${id}: ${p.previousUsername || '(none)'} → ${p.newUsername}`,
  create_team: (id) => `Created team ${id}`,
  update_team: (id) => `Updated team ${id}`,
  delete_team: (id) => `Deleted team ${id}`,
  add_team_member: (id, p) => `Added ${p.username} to team ${id}`,
  remove_team_member: (id, p) => `Removed ${p.username} from team ${id}`,
  update_repo: (id) => `Updated repo ${id}`,
  add_repo_team_access: (id, p) => `Granted ${p.teamSlug} access to repo ${id}`,
  remove_repo_team_access: (id, p) => `Revoked ${p.teamSlug} access from repo ${id}`,
  add_repo_collaborator: (id, p) => `Added ${p.username} as collaborator on repo ${id}`,
  remove_repo_collaborator: (id, p) => `Removed ${p.username} from repo ${id}`,
};

function formatActionSummary(row: typeof auditLog.$inferSelect): string {
  const formatter = ACTION_LABELS[row.action];
  if (formatter) {
    return formatter(row.entityId, (row.payload ?? {}) as Record<string, unknown>);
  }
  return `${row.action} on ${row.entityType} ${row.entityId}`;
}

function syncRowToEntry(row: typeof syncHistory.$inferSelect): ActivityEntry {
  return {
    id: `sync-${row.id}`,
    type: 'sync',
    timestamp: row.startedAt.toISOString(),
    trigger: row.triggeredBy,
    summary: formatSyncSummary(row),
    details: {
      invitedCount: row.invitedCount,
      removedCount: row.removedCount,
      errorCount: row.errorCount,
      completedAt: row.completedAt?.toISOString() ?? null,
      ...((row.details as Record<string, unknown>) ?? {}),
    },
  };
}

function actionRowToEntry(row: typeof auditLog.$inferSelect): ActivityEntry {
  return {
    id: `action-${row.id}`,
    type: 'action',
    timestamp: row.performedAt.toISOString(),
    trigger: 'dashboard',
    summary: formatActionSummary(row),
    details: {
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      payload: row.payload,
    },
  };
}

// Merges both feeds newest-first and returns one page of the combined timeline
export function mergeActivityPage(
  sync: ActivityEntry[],
  action: ActivityEntry[],
  page: number,
  limit: number,
): ActivityEntry[] {
  const offset = (page - 1) * limit;
  return [...sync, ...action]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(offset, offset + limit);
}

// Ids break timestamp ties so separate page requests see one stable order
function fetchSyncEntries(limit: number, offset: number) {
  return dbQuery(async () => {
    const [rows, [{ count }]] = await Promise.all([
      db
        .select()
        .from(syncHistory)
        .orderBy(desc(syncHistory.startedAt), desc(syncHistory.id))
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`count(*)::int` }).from(syncHistory),
    ]);
    return { items: rows.map(syncRowToEntry), count };
  });
}

function fetchActionEntries(limit: number, offset: number) {
  return dbQuery(async () => {
    const [rows, [{ count }]] = await Promise.all([
      db
        .select()
        .from(auditLog)
        .orderBy(desc(auditLog.performedAt), desc(auditLog.id))
        .limit(limit)
        .offset(offset),
      db.select({ count: sql<number>`count(*)::int` }).from(auditLog),
    ]);
    return { items: rows.map(actionRowToEntry), count };
  });
}

export const ActivityHandlers = HttpApiBuilder.group(DashboardApi, 'activity', (handlers) =>
  handlers.handleAll({
    list: Effect.fn(function* ({ query }) {
      const page = Math.max(1, query.page ?? 1);
      const limit = Math.min(100, Math.max(1, query.limit ?? 25));
      const offset = (page - 1) * limit;

      if (query.type === 'sync') {
        const { items, count } = yield* fetchSyncEntries(limit, offset);
        return { items, page, limit, totalCount: count };
      }

      if (query.type === 'action') {
        const { items, count } = yield* fetchActionEntries(limit, offset);
        return { items, page, limit, totalCount: count };
      }

      // No filter: per-table offsets don't compose, so fetch every row up to the end of
      // this page from both tables and window the merged timeline instead
      const rowsNeeded = offset + limit;
      const [sync, action] = yield* Effect.all(
        [fetchSyncEntries(rowsNeeded, 0), fetchActionEntries(rowsNeeded, 0)],
        { concurrency: 'unbounded' },
      );

      const items = mergeActivityPage(sync.items, action.items, page, limit);
      return { items, page, limit, totalCount: sync.count + action.count };
    }),
  }),
);
