import { google } from 'googleapis';
import { envVars } from '../lib/config.ts';

export type GoogleUser = {
  primaryEmail?: string | null;
  customSchemas?: {
    '3rd-party_tools'?: {
      GitHub_Username?: string;
    } | null;
  } | null;
};

export function createGoogleAuth() {
  return new google.auth.GoogleAuth({
    credentials: JSON.parse(envVars.GOOGLE_APPLICATION_CREDENTIALS),
    scopes: ['https://www.googleapis.com/auth/admin.directory.user.readonly'],
    clientOptions: {
      subject: envVars.GOOGLE_ADMIN_EMAIL, // impersonate the admin user
    },
  });
}

export async function getWorkspaceUsers(
  auth: ReturnType<typeof createGoogleAuth>,
): Promise<GoogleUser[]> {
  const directory = google.admin({
    version: 'directory_v1',
    auth: auth,
  });

  try {
    const response = await directory.users.list({
      customer: 'my_customer',
      projection: 'full',
      viewType: 'admin_view',
      maxResults: 300,
    });

    return response.data.users || [];
  } catch (e) {
    console.error('Error fetching Google Workspace users', e);
    throw e;
  }
}
