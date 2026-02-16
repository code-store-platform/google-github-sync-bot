import * as path from 'node:path';
import * as dotenv from 'dotenv';
import { z } from 'zod';

// Load .env from monorepo root (two levels up from packages/server)
dotenv.config({ path: path.resolve(import.meta.dirname, '../../../../.env') });

const envVariables = z.object({
  GOOGLE_APPLICATION_CREDENTIALS: z.string(),
  GOOGLE_ADMIN_EMAIL: z.string(),
  GITHUB_TOKEN: z.string(),
  GITHUB_ORG_NAME: z.string(),
  SLACK_BOT_TOKEN: z.string(),
  SLACK_SIGNING_SECRET: z.string(),
  SLACK_APP_TOKEN: z.string(),
  PORT: z.string().default('3000'),
  API_PORT: z.string().default('4000'),
  CORS_ORIGIN: z.string().default('http://localhost:3001'),
  DATABASE_URL: z.string().default('postgres://postgres:postgres@localhost:5432/dashboard'),
  CRON_SCHEDULE: z.string().default('0 0 0 * * *'),
  REMOVE_STOP_LIST: z
    .string()
    .optional()
    .transform((val) => val?.split(',').map((s) => s.trim()) || []),
  ATLASSIAN_API_KEY: z.string(),
  ATLASSIAN_ORG_ID: z.string(),
  ATLASSIAN_ADMIN_EMAIL: z.string(),
  ATLASSIAN_SUSPEND_STOP_LIST: z
    .string()
    .optional()
    .transform((val) => val?.split(',').map((s) => s.trim()) || []),
  ATLASSIAN_DRY_RUN: z
    .string()
    .optional()
    .transform((val) => val === 'true' || val === '1'),
  ATLASSIAN_GRACE_PERIOD_DAYS: z
    .string()
    .optional()
    .default('7')
    .transform((val) => parseInt(val, 10)),
  ATLASSIAN_INACTIVITY_CRON_SCHEDULE: z.string().default('0 0 0 * * *'),
});

export const envVars = envVariables.parse(process.env);
