import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { envVars } from '../lib/config';
import * as schema from './schema';

const client = postgres(envVars.DATABASE_URL);

export const db = drizzle(client, { schema });
