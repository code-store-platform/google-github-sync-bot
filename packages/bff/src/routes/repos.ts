import { auditLog } from '@google-github-sync/shared/db/schema';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { GitHubReposService } from '../services/github-repos';

export const repoRoutes = new Hono();

const reposService = new GitHubReposService();

const validVisibilities = new Set(['public', 'private']);
const validPermissions = new Set(['pull', 'triage', 'push', 'maintain', 'admin']);

repoRoutes.get('/', async (c) => {
  const repos = await reposService.listRepos();
  return c.json(repos);
});

repoRoutes.get('/:name', async (c) => {
  const name = c.req.param('name');
  const repo = await reposService.getRepo(name);
  return c.json(repo);
});

repoRoutes.patch('/:name', async (c) => {
  const name = c.req.param('name');
  const body = await c.req.json<{
    description?: string;
    homepage?: string;
    visibility?: string;
    archived?: boolean;
    topics?: string[];
  }>();

  if (body.visibility && !validVisibilities.has(body.visibility)) {
    throw new HTTPException(400, { message: 'visibility must be "public" or "private"' });
  }

  if (body.topics) {
    await reposService.updateTopics(name, body.topics);
  }

  const updates: {
    description?: string;
    homepage?: string;
    visibility?: 'public' | 'private';
    archived?: boolean;
  } = {};
  if (body.description !== undefined) updates.description = body.description;
  if (body.homepage !== undefined) updates.homepage = body.homepage;
  if (body.visibility !== undefined) updates.visibility = body.visibility as 'public' | 'private';
  if (body.archived !== undefined) updates.archived = body.archived;

  const repo =
    Object.keys(updates).length > 0
      ? await reposService.updateRepo(name, updates)
      : await reposService.getRepo(name);

  await db.insert(auditLog).values({
    action: 'update_repo',
    entityType: 'repo',
    entityId: name,
    payload: { ...updates, ...(body.topics ? { topics: body.topics } : {}) },
  });

  return c.json(repo);
});

repoRoutes.get('/:name/teams', async (c) => {
  const name = c.req.param('name');
  const teams = await reposService.listRepoTeams(name);
  return c.json(teams);
});

repoRoutes.put('/:name/teams/:teamSlug', async (c) => {
  const name = c.req.param('name');
  const teamSlug = c.req.param('teamSlug');
  const body = await c.req.json<{ permission?: string }>();

  const permission = body.permission || 'push';

  if (!validPermissions.has(permission)) {
    throw new HTTPException(400, {
      message: 'permission must be "pull", "triage", "push", "maintain", or "admin"',
    });
  }

  await reposService.addTeamAccess(
    name,
    teamSlug,
    permission as 'pull' | 'triage' | 'push' | 'maintain' | 'admin',
  );

  await db.insert(auditLog).values({
    action: 'add_repo_team_access',
    entityType: 'repo',
    entityId: name,
    payload: { teamSlug, permission },
  });

  return c.json({ success: true });
});

repoRoutes.delete('/:name/teams/:teamSlug', async (c) => {
  const name = c.req.param('name');
  const teamSlug = c.req.param('teamSlug');

  await reposService.removeTeamAccess(name, teamSlug);

  await db.insert(auditLog).values({
    action: 'remove_repo_team_access',
    entityType: 'repo',
    entityId: name,
    payload: { teamSlug },
  });

  return c.json({ success: true });
});
