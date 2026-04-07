import { normalizeGitHubUsername, getGitHubUsername } from '@google-github-sync/shared/utils';
import { auditLog } from '@google-github-sync/shared/db/schema';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { GitHubMembershipService } from '../services/github-membership';
import { GitHubReposService } from '../services/github-repos';
import { GitHubTeamsService } from '../services/github-teams';
import {
  createGoogleAuth,
  getWorkspaceUser,
  getWorkspaceUsers,
  updateUserCustomSchema,
} from '../services/google-workspace';

export const userRoutes = new Hono();

const auth = createGoogleAuth();
const membership = new GitHubMembershipService();
const teamsService = new GitHubTeamsService();
const reposService = new GitHubReposService();

export type UserStatus = 'member' | 'pending_invite' | 'not_linked' | 'linked_not_in_org';

export type UserListItem = {
  email: string;
  name: string | null;
  githubUsername: string | null;
  status: UserStatus;
  avatarUrl: string | null;
  suspended: boolean;
};

function computeUserStatus(
  githubUsername: string | null,
  memberUsernames: Set<string>,
  invitedUsernames: Set<string>,
): UserStatus {
  if (!githubUsername) return 'not_linked';
  const normalized = normalizeGitHubUsername(githubUsername);
  if (memberUsernames.has(normalized)) return 'member';
  if (invitedUsernames.has(normalized)) return 'pending_invite';
  return 'linked_not_in_org';
}

userRoutes.get('/', async (c) => {
  const [workspaceUsers, memberUsernames, invitedUsernames] = await Promise.all([
    getWorkspaceUsers(auth),
    membership.getMemberUsernames(),
    membership.getInvitedUsernames(),
  ]);

  const users: UserListItem[] = workspaceUsers.map((user) => {
    const githubUsername = getGitHubUsername(user);
    return {
      email: user.primaryEmail || '',
      name: user.name?.fullName || null,
      githubUsername,
      status: computeUserStatus(githubUsername, memberUsernames, invitedUsernames),
      avatarUrl: user.thumbnailPhotoUrl || null,
      suspended: user.suspended || false,
    };
  });

  return c.json(users);
});

userRoutes.get('/:email/teams', async (c) => {
  const email = decodeURIComponent(c.req.param('email'));

  const user = await getWorkspaceUser(auth, email);
  if (!user) {
    throw new HTTPException(404, { message: 'User not found' });
  }

  const githubUsername = getGitHubUsername(user);
  if (!githubUsername) {
    return c.json([]);
  }

  const teams = await teamsService.listTeamsForUser(githubUsername);
  return c.json(teams);
});

userRoutes.get('/:email/repos', async (c) => {
  const email = decodeURIComponent(c.req.param('email'));

  const user = await getWorkspaceUser(auth, email);
  if (!user) {
    throw new HTTPException(404, { message: 'User not found' });
  }

  const githubUsername = getGitHubUsername(user);
  if (!githubUsername) {
    return c.json({ direct: [], teams: [] });
  }

  const userTeams = await teamsService.listTeamsForUser(githubUsername);

  const [direct, teams] = await Promise.all([
    reposService.listDirectCollaboratorRepos(githubUsername),
    reposService.listReposViaTeams(
      userTeams.map((t) => ({ slug: t.slug, name: t.name })),
    ),
  ]);

  return c.json({ direct, teams });
});

userRoutes.get('/:email', async (c) => {
  const email = decodeURIComponent(c.req.param('email'));

  const [user, memberUsernames, invitedUsernames] = await Promise.all([
    getWorkspaceUser(auth, email),
    membership.getMemberUsernames(),
    membership.getInvitedUsernames(),
  ]);

  if (!user) {
    throw new HTTPException(404, { message: 'User not found' });
  }

  const githubUsername = getGitHubUsername(user);

  return c.json({
    email: user.primaryEmail || '',
    name: user.name?.fullName || null,
    givenName: user.name?.givenName || null,
    familyName: user.name?.familyName || null,
    githubUsername,
    status: computeUserStatus(githubUsername, memberUsernames, invitedUsernames),
    avatarUrl: user.thumbnailPhotoUrl || null,
    suspended: user.suspended || false,
  });
});

userRoutes.patch('/:email/github-username', async (c) => {
  const email = decodeURIComponent(c.req.param('email'));
  const body = await c.req.json<{ githubUsername: string }>();

  if (typeof body.githubUsername !== 'string') {
    throw new HTTPException(400, { message: 'githubUsername is required' });
  }

  const user = await getWorkspaceUser(auth, email);
  if (!user) {
    throw new HTTPException(404, { message: 'User not found' });
  }

  const previousUsername = getGitHubUsername(user);

  await updateUserCustomSchema(email, body.githubUsername);

  await db.insert(auditLog).values({
    action: 'update_github_username',
    entityType: 'user',
    entityId: email,
    payload: {
      previousUsername,
      newUsername: body.githubUsername,
    },
  });

  return c.json({ success: true });
});
