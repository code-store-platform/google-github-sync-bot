import { listAllGoogleUsers } from '@google-github-sync/shared/google-pagination';
import { Context, Layer } from 'effect';
import { google } from 'googleapis';
import { envVars } from '../lib/config';

export type GoogleUser = {
  primaryEmail?: string | null;
  name?: {
    fullName?: string | null;
    givenName?: string | null;
    familyName?: string | null;
  } | null;
  thumbnailPhotoUrl?: string | null;
  suspended?: boolean | null;
  customSchemas?: {
    '3rd-party_tools'?: {
      GitHub_Username?: string;
    } | null;
  } | null;
};

function createGoogleAuth() {
  return new google.auth.GoogleAuth({
    credentials: JSON.parse(envVars.GOOGLE_APPLICATION_CREDENTIALS),
    scopes: ['https://www.googleapis.com/auth/admin.directory.user.readonly'],
    clientOptions: {
      subject: envVars.GOOGLE_ADMIN_EMAIL,
    },
  });
}

function createGoogleAuthReadWrite() {
  return new google.auth.GoogleAuth({
    credentials: JSON.parse(envVars.GOOGLE_APPLICATION_CREDENTIALS),
    scopes: ['https://www.googleapis.com/auth/admin.directory.user'],
    clientOptions: {
      subject: envVars.GOOGLE_ADMIN_EMAIL,
    },
  });
}

async function getWorkspaceUsers(auth: ReturnType<typeof createGoogleAuth>): Promise<GoogleUser[]> {
  const directory = google.admin({
    version: 'directory_v1',
    auth: auth,
  });

  try {
    return await listAllGoogleUsers<GoogleUser>(async (pageToken) => {
      const response = await directory.users.list({
        customer: 'my_customer',
        projection: 'full',
        viewType: 'admin_view',
        maxResults: 300,
        pageToken,
      });
      return response.data;
    });
  } catch (e) {
    console.error('Error fetching Google Workspace users', e);
    throw e;
  }
}

async function getWorkspaceUser(
  auth: ReturnType<typeof createGoogleAuth>,
  email: string,
): Promise<GoogleUser | null> {
  const directory = google.admin({
    version: 'directory_v1',
    auth: auth,
  });

  try {
    const response = await directory.users.get({
      userKey: email,
      projection: 'full',
      viewType: 'admin_view',
    });

    return response.data || null;
  } catch (e) {
    console.error(`Error fetching Google Workspace user ${email}`, e);
    return null;
  }
}

async function updateUserCustomSchema(email: string, githubUsername: string): Promise<void> {
  const auth = createGoogleAuthReadWrite();
  const directory = google.admin({
    version: 'directory_v1',
    auth: auth,
  });

  try {
    await directory.users.update({
      userKey: email,
      requestBody: {
        customSchemas: {
          '3rd-party_tools': {
            GitHub_Username: githubUsername,
          },
        },
      },
    });
  } catch (e) {
    console.error(`Error updating GitHub username for ${email}`, e);
    throw e;
  }
}

export class GoogleWorkspace extends Context.Service<
  GoogleWorkspace,
  {
    readonly listUsers: () => Promise<GoogleUser[]>;
    readonly getUser: (email: string) => Promise<GoogleUser | null>;
    readonly updateGitHubUsername: (email: string, githubUsername: string) => Promise<void>;
  }
>()('bff/GoogleWorkspace') {
  static readonly layer = Layer.sync(GoogleWorkspace, () => {
    const auth = createGoogleAuth();
    return {
      listUsers: () => getWorkspaceUsers(auth),
      getUser: (email) => getWorkspaceUser(auth, email),
      updateGitHubUsername: updateUserCustomSchema,
    };
  });
}
