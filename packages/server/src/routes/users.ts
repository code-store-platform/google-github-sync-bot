import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { db } from '../db';
import { auditLog } from '../db/schema';
import { normalizeGitHubUsername } from '../lib/utils';
import { WorkspaceGitHubSync } from '../services/github-sync';
import {
  createGoogleAuth,
  getWorkspaceUser,
  getWorkspaceUsers,
  updateUserCustomSchema,
} from '../services/google-workspace';

export const userRoutes = new Hono();

const auth = createGoogleAuth();
const githubSync = new WorkspaceGitHubSync();

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

// GET /api/users - List all workspace users with GitHub status
userRoutes.get('/', async (c) => {
  const [workspaceUsers, memberUsernames, invitedUsernames] = await Promise.all([
    getWorkspaceUsers(auth),
    githubSync.getGithubMemberUsernames(),
    githubSync.getGithubInvitedUsers(),
  ]);

  const users: UserListItem[] = workspaceUsers.map((user) => {
    const githubUsername = user.customSchemas?.['3rd-party_tools']?.GitHub_Username || null;
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

// GET /api/users/:email - Single user detail
userRoutes.get('/:email', async (c) => {
  const email = decodeURIComponent(c.req.param('email'));

  const [user, memberUsernames, invitedUsernames] = await Promise.all([
    getWorkspaceUser(auth, email),
    githubSync.getGithubMemberUsernames(),
    githubSync.getGithubInvitedUsers(),
  ]);

  if (!user) {
    throw new HTTPException(404, { message: 'User not found' });
  }

  const githubUsername = user.customSchemas?.['3rd-party_tools']?.GitHub_Username || null;

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

// PATCH /api/users/:email/github-username - Update GitHub username
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

  const previousUsername = user.customSchemas?.['3rd-party_tools']?.GitHub_Username || null;

  await updateUserCustomSchema(email, body.githubUsername);

  // Write audit log
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
