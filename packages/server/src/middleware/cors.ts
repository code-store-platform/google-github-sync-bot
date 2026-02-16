import { cors } from 'hono/cors';
import { envVars } from '../lib/config';

export const corsMiddleware = cors({
  origin: envVars.CORS_ORIGIN,
  allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
});
