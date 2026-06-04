import { Hono } from 'hono';
import { envVars } from './lib/config';
import { corsMiddleware } from './middleware/cors';
import { errorHandler } from './middleware/error-handler';
import { activityRoutes } from './routes/activity';
import { repoRoutes } from './routes/repos';
import { syncRoutes } from './routes/sync';
import { teamRoutes } from './routes/teams';
import { userRoutes } from './routes/users';

const api = new Hono();

api.use('*', corsMiddleware);
api.onError(errorHandler);

api.get('/health', (c) => c.json({ status: 'ok' }));
api.route('/api/users', userRoutes);
api.route('/api/teams', teamRoutes);
api.route('/api/repos', repoRoutes);
api.route('/api/sync', syncRoutes);
api.route('/api/activity', activityRoutes);

Bun.serve({
  port: Number(envVars.API_PORT),
  fetch: api.fetch,
});

console.log(`BFF server running on port ${envVars.API_PORT}`);
