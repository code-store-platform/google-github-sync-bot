import { z } from 'zod';

const envVariables = z.object({
  GOOGLE_APPLICATION_CREDENTIALS: z.string(),
  GOOGLE_ADMIN_EMAIL: z.string(),
  GITHUB_TOKEN: z.string(),
  GITHUB_ORG_NAME: z.string(),
  SLACK_BOT_TOKEN: z.string(),
  SLACK_SIGNING_SECRET: z.string(),
  SLACK_APP_TOKEN: z.string(),
  PORT: z.string().default('3000'),
  CRON_SCHEDULE: z.string().default('0 0 0 * * *'),
  REMOVE_STOP_LIST: z
    .string()
    .optional()
    .transform((val) => val?.split(',').map((s) => s.trim()) || []),
  ATLASSIAN_API_KEY: z.string(),
  ATLASSIAN_ORG_ID: z.string(),
  ATLASSIAN_ADMIN_EMAIL: z.string(),
  ATLASSIAN_INACTIVITY_3M_SCHEDULE: z.string().default('0 0 2 * * 0'),
  ATLASSIAN_INACTIVITY_6M_SCHEDULE: z.string().default('0 0 3 * * 0'),
  ATLASSIAN_SUSPEND_STOP_LIST: z
    .string()
    .optional()
    .transform((val) => val?.split(',').map((s) => s.trim()) || []),
  ATLASSIAN_DRY_RUN: z
    .string()
    .optional()
    .transform((val) => val === 'true' || val === '1'),
});

export const envVars = envVariables.parse(process.env);
