import { Context, Effect, Layer } from 'effect';
import { google } from 'googleapis';
import { describeError, GoogleWorkspaceError } from '../lib/errors';
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

export class GoogleWorkspaceService extends Context.Tag('GoogleWorkspaceService')<
  GoogleWorkspaceService,
  {
    readonly getUsers: () => Effect.Effect<GoogleUser[], GoogleWorkspaceError>;
  }
>() {}

export const GoogleWorkspaceServiceLive = Layer.succeed(GoogleWorkspaceService, {
  getUsers: () =>
    Effect.tryPromise({
      try: async () => {
        const auth = new google.auth.GoogleAuth({
          credentials: JSON.parse(envVars.GOOGLE_APPLICATION_CREDENTIALS),
          scopes: ['https://www.googleapis.com/auth/admin.directory.user.readonly'],
          clientOptions: {
            subject: envVars.GOOGLE_ADMIN_EMAIL,
          },
        });

        const directory = google.admin({ version: 'directory_v1', auth });

        const response = await directory.users.list({
          customer: 'my_customer',
          projection: 'full',
          viewType: 'admin_view',
          maxResults: 300,
        });

        return (response.data.users || []) as GoogleUser[];
      },
      catch: (e) =>
        new GoogleWorkspaceError({ message: `Failed to fetch users: ${describeError(e)}` }),
    }),
});
