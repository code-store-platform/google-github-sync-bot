import { z } from 'zod';

const envVariables = z.object({
  DATABASE_URL: z.string().default('postgres://postgres:postgres@localhost:5432/dashboard'),
  GOOGLE_APPLICATION_CREDENTIALS: z.string(),
  GOOGLE_ADMIN_EMAIL: z.string(),
  GITHUB_TOKEN: z.string(),
  GITHUB_ORG_NAME: z.string(),
  CRON_SCHEDULE: z.string().default('0 0 0 * * *'),
  REMOVE_STOP_LIST: z
    .string()
    .optional()
    .transform((val) => val?.split(',').map((s) => s.trim()) || []),
  SLACK_BOT_TOKEN: z.string().optional(),
  SLACK_NOTIFICATION_CHANNEL: z.string().optional(),
  // Atlassian feature flag
  ATLASSIAN_ENABLED: z
    .string()
    .optional()
    .transform((val) => val === 'true' || val === '1'),
  ATLASSIAN_API_KEY: z.string().optional(),
  ATLASSIAN_ORG_ID: z.string().optional(),
  ATLASSIAN_ADMIN_EMAIL: z.string().optional(),
  ATLASSIAN_SUSPEND_STOP_LIST: z
    .string()
    .optional()
    .transform((val) => val?.split(',').map((s) => s.trim()) || []),
  ATLASSIAN_DRY_RUN: z
    .string()
    .optional()
    .transform((val) => val === 'true' || val === '1'),
  ATLASSIAN_INACTIVITY_CRON_SCHEDULE: z.string().default('0 0 0 * * *'),
});

export const envVars = envVariables.parse(process.env);

// Validate Atlassian config when enabled
if (envVars.ATLASSIAN_ENABLED) {
  if (!envVars.ATLASSIAN_API_KEY || !envVars.ATLASSIAN_ORG_ID || !envVars.ATLASSIAN_ADMIN_EMAIL) {
    throw new Error(
      'ATLASSIAN_ENABLED is true but ATLASSIAN_API_KEY, ATLASSIAN_ORG_ID, and ATLASSIAN_ADMIN_EMAIL are required',
    );
  }
}
