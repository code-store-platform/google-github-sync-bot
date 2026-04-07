import { createDb } from '@google-github-sync/shared/db';
import { envVars } from '../lib/config';

export const db = createDb(envVars.DATABASE_URL);
