import { z } from 'zod';

const envVariables = z.object({
  GOOGLE_APPLICATION_CREDENTIALS: z.string(),
  GOOGLE_ADMIN_EMAIL: z.string(),
  GITHUB_TOKEN: z.string(),
  GITHUB_ORG_NAME: z.string(),
  API_PORT: z.string().default('4000'),
  CORS_ORIGIN: z.string().default('http://localhost:3001'),
  DATABASE_URL: z.string().default('postgres://postgres:postgres@localhost:5432/dashboard'),
});

export const envVars = envVariables.parse(process.env);
