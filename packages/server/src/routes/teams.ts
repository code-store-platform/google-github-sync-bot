import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { auditLog } from '../db/schema';
import { GitHubTeamsService } from '../services/github-teams';

export const teamRoutes = new Hono();

const teamsService = new GitHubTeamsService();

// GET /api/teams - List all teams
teamRoutes.get('/', async (c) => {
  const teams = await teamsService.listTeams();
  return c.json(teams);
});

// POST /api/teams - Create a team
teamRoutes.post('/', async (c) => {
  const body = await c.req.json<{ name?: string; description?: string; privacy?: string }>();

  if (!body.name || typeof body.name !== 'string' || body.name.trim() === '') {
    throw new HTTPException(400, { message: 'name is required' });
  }

  if (body.privacy && body.privacy !== 'closed' && body.privacy !== 'secret') {
    throw new HTTPException(400, { message: 'privacy must be "closed" or "secret"' });
  }

  const team = await teamsService.createTeam({
    name: body.name.trim(),
    description: body.description,
    privacy: (body.privacy as 'closed' | 'secret') || 'closed',
  });

  await db.insert(auditLog).values({
    action: 'create_team',
    entityType: 'team',
    entityId: team.slug,
    payload: { name: team.name, privacy: team.privacy },
  });

  return c.json(team, 201);
});

// GET /api/teams/:slug - Get team detail
teamRoutes.get('/:slug', async (c) => {
  const slug = c.req.param('slug');
  const team = await teamsService.getTeam(slug);
  return c.json(team);
});

// PATCH /api/teams/:slug - Update a team
teamRoutes.patch('/:slug', async (c) => {
  const slug = c.req.param('slug');
  const body = await c.req.json<{ name?: string; description?: string; privacy?: string }>();

  if (body.privacy && body.privacy !== 'closed' && body.privacy !== 'secret') {
    throw new HTTPException(400, { message: 'privacy must be "closed" or "secret"' });
  }

  const updates: { name?: string; description?: string; privacy?: 'closed' | 'secret' } = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.description !== undefined) updates.description = body.description;
  if (body.privacy !== undefined) updates.privacy = body.privacy as 'closed' | 'secret';

  const team = await teamsService.updateTeam(slug, updates);

  await db.insert(auditLog).values({
    action: 'update_team',
    entityType: 'team',
    entityId: slug,
    payload: updates,
  });

  return c.json(team);
});

// DELETE /api/teams/:slug - Delete a team
teamRoutes.delete('/:slug', async (c) => {
  const slug = c.req.param('slug');

  await teamsService.deleteTeam(slug);

  await db.insert(auditLog).values({
    action: 'delete_team',
    entityType: 'team',
    entityId: slug,
    payload: {},
  });

  return c.json({ success: true });
});

// GET /api/teams/:slug/members - List team members
teamRoutes.get('/:slug/members', async (c) => {
  const slug = c.req.param('slug');
  const members = await teamsService.listTeamMembers(slug);
  return c.json(members);
});

// POST /api/teams/:slug/members - Add a team member
teamRoutes.post('/:slug/members', async (c) => {
  const slug = c.req.param('slug');
  const body = await c.req.json<{ username?: string; role?: string }>();

  if (!body.username || typeof body.username !== 'string' || body.username.trim() === '') {
    throw new HTTPException(400, { message: 'username is required' });
  }

  if (body.role && body.role !== 'member' && body.role !== 'maintainer') {
    throw new HTTPException(400, { message: 'role must be "member" or "maintainer"' });
  }

  await teamsService.addTeamMember(slug, {
    username: body.username.trim(),
    role: (body.role as 'member' | 'maintainer') || 'member',
  });

  await db.insert(auditLog).values({
    action: 'add_team_member',
    entityType: 'team',
    entityId: slug,
    payload: { username: body.username.trim(), role: body.role || 'member' },
  });

  return c.json({ success: true });
});

// DELETE /api/teams/:slug/members/:username - Remove a team member
teamRoutes.delete('/:slug/members/:username', async (c) => {
  const slug = c.req.param('slug');
  const username = c.req.param('username');

  await teamsService.removeTeamMember(slug, username);

  await db.insert(auditLog).values({
    action: 'remove_team_member',
    entityType: 'team',
    entityId: slug,
    payload: { username },
  });

  return c.json({ success: true });
});
