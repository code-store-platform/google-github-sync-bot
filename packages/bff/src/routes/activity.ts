import { desc, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { auditLog, syncHistory } from '@google-github-sync/shared/db/schema';
import { db } from '../db';

export const activityRoutes = new Hono();

type ActivityEntry = {
  id: string;
  type: 'sync' | 'action';
  timestamp: string;
  trigger: string;
  summary: string;
  details: unknown;
};

function formatSyncSummary(row: typeof syncHistory.$inferSelect): string {
  const parts = [];
  if (row.invitedCount > 0) parts.push(`${row.invitedCount} invited`);
  if (row.removedCount > 0) parts.push(`${row.removedCount} removed`);
  if (row.errorCount > 0) parts.push(`${row.errorCount} errors`);
  if (parts.length === 0) parts.push('no changes');
  return `GitHub sync: ${parts.join(', ')}`;
}

const ACTION_LABELS: Record<string, (entityId: string, payload: Record<string, unknown>) => string> = {
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

async function fetchSyncEntries(limit: number, offset: number) {
  const [rows, [{ count }]] = await Promise.all([
    db.select().from(syncHistory).orderBy(desc(syncHistory.startedAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(syncHistory),
  ]);
  return { items: rows.map(syncRowToEntry), count };
}

async function fetchActionEntries(limit: number, offset: number) {
  const [rows, [{ count }]] = await Promise.all([
    db.select().from(auditLog).orderBy(desc(auditLog.performedAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(auditLog),
  ]);
  return { items: rows.map(actionRowToEntry), count };
}

// GET /api/activity?page=1&limit=25&type=sync|action
activityRoutes.get('/', async (c) => {
  const page = Math.max(1, Number(c.req.query('page') || '1'));
  const limit = Math.min(100, Math.max(1, Number(c.req.query('limit') || '25')));
  const typeFilter = c.req.query('type') as 'sync' | 'action' | undefined;
  const offset = (page - 1) * limit;

  if (typeFilter === 'sync') {
    const { items, count } = await fetchSyncEntries(limit, offset);
    return c.json({ items, page, limit, totalCount: count });
  }

  if (typeFilter === 'action') {
    const { items, count } = await fetchActionEntries(limit, offset);
    return c.json({ items, page, limit, totalCount: count });
  }

  // No filter: fetch both, merge by timestamp, trim to page size
  const [sync, action] = await Promise.all([
    fetchSyncEntries(limit, offset),
    fetchActionEntries(limit, offset),
  ]);

  const items = [...sync.items, ...action.items]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);

  return c.json({
    items,
    page,
    limit,
    totalCount: sync.count + action.count,
  });
});
