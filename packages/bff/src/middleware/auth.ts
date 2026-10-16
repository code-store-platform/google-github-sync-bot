import { secretMatches } from '@google-github-sync/shared/server-auth';
import { Effect } from 'effect';
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http';

export function bearerAuth(token: string) {
  if (token.length < 32) throw new Error('API_AUTH_TOKEN must contain at least 32 characters');
  return HttpRouter.middleware((httpEffect) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest;
      const path = new URL(request.url, 'http://localhost').pathname;
      if ((request.method === 'GET' || request.method === 'HEAD') && path === '/health') {
        return yield* httpEffect;
      }
      const authorization = request.headers.authorization ?? '';
      if (!secretMatches(authorization, `Bearer ${token}`)) {
        return HttpServerResponse.empty({
          status: 401,
          headers: { 'www-authenticate': 'Bearer', 'cache-control': 'no-store' },
        });
      }
      return yield* httpEffect;
    }),
  ).layer;
}
