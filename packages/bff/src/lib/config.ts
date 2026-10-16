import { Config, Effect, Schema } from 'effect';

const BffConfig = Config.all({
  GOOGLE_APPLICATION_CREDENTIALS: Config.NonEmptyString('GOOGLE_APPLICATION_CREDENTIALS'),
  GOOGLE_ADMIN_EMAIL: Config.NonEmptyString('GOOGLE_ADMIN_EMAIL'),
  GITHUB_TOKEN: Config.NonEmptyString('GITHUB_TOKEN'),
  GITHUB_ORG_NAME: Config.NonEmptyString('GITHUB_ORG_NAME'),
  API_AUTH_TOKEN: Config.schema(Schema.String.check(Schema.isMinLength(32)), 'API_AUTH_TOKEN'),
  API_PORT: Config.Port('API_PORT').pipe(Config.withDefault(4000)),
  CORS_ORIGIN: Config.String('CORS_ORIGIN').pipe(Config.withDefault('http://localhost:3001')),
  DATABASE_URL: Config.String('DATABASE_URL').pipe(
    Config.withDefault('postgres://postgres:postgres@localhost:5432/dashboard'),
  ),
});

// Read once at startup from the environment; a missing or invalid var fails fast
export const envVars = Effect.runSync(BffConfig);
