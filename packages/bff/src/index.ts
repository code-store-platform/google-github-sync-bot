import { BunHttpServer, BunRuntime } from '@effect/platform-bun';
import { DashboardApi } from '@google-github-sync/shared/api';
import { Effect, Layer } from 'effect';
import { HttpRouter } from 'effect/http';
import { HttpApiBuilder } from 'effect/http-api';
import { ActivityHandlers } from './handlers/activity';
import { ReposHandlers } from './handlers/repos';
import { SyncHandlers } from './handlers/sync';
import { TeamsHandlers } from './handlers/teams';
import { UsersHandlers } from './handlers/users';
import { bearerAuth } from './middleware/auth';
import { envVars } from './lib/config';
import { GitHubMembership } from './services/github-membership';
import { GitHubRepos } from './services/github-repos';
import { GitHubTeams } from './services/github-teams';
import { GoogleWorkspace } from './services/google-workspace';

const SystemHandlers = HttpApiBuilder.group(DashboardApi, 'system', (handlers) =>
  handlers.handle('health', () => Effect.succeed('ok')),
);

const ApiRoutes = HttpApiBuilder.layer(DashboardApi).pipe(
  Layer.provide(bearerAuth(envVars.API_AUTH_TOKEN)),
  Layer.provide([
    UsersHandlers,
    TeamsHandlers,
    ReposHandlers,
    SyncHandlers,
    ActivityHandlers,
    SystemHandlers,
  ]),
  Layer.provide([
    GoogleWorkspace.layer,
    GitHubMembership.layer,
    GitHubTeams.layer,
    GitHubRepos.layer,
  ]),
);

const Cors = HttpRouter.cors({
  allowedOrigins: [envVars.CORS_ORIGIN],
  allowedMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
});

const Server = HttpRouter.serve(Layer.mergeAll(ApiRoutes, Cors)).pipe(
  Layer.provide(BunHttpServer.layer({ port: envVars.API_PORT })),
);

Layer.launch(Server).pipe(BunRuntime.runMain);
