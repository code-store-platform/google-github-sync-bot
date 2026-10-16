import { BunHttpServer } from '@effect/platform-bun';
import { expect, test } from 'bun:test';
import { Effect, Layer, Schema } from 'effect';
import { HttpRouter, HttpServerResponse } from 'effect/http';
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from 'effect/http-api';
import { bearerAuth } from './auth';

const token = 'test-api-token-at-least-32-characters';

test('protects reads and mutations while leaving only health public', async () => {
  const routes = Layer.mergeAll(
    HttpRouter.add('GET', '/api/users', HttpServerResponse.text('users')),
    HttpRouter.add('POST', '/api/sync/github', HttpServerResponse.text('queued')),
    HttpRouter.add('GET', '/health', HttpServerResponse.text('ok')),
  ).pipe(Layer.provide(bearerAuth(token)));
  const { handler, dispose } = HttpRouter.toWebHandler(routes, { disableLogger: true });
  try {
    for (const [path, method] of [
      ['/api/users', 'GET'],
      ['/api/sync/github', 'POST'],
    ]) {
      for (const authorization of ['', 'Bearer incorrect', 'Basic abc']) {
        const response = await handler(
          new Request(`http://localhost${path}`, { method, headers: { authorization } }),
        );
        expect(response.status).toBe(401);
      }
      const response = await handler(
        new Request(`http://localhost${path}`, {
          method,
          headers: { authorization: `Bearer ${token}` },
        }),
      );
      expect(response.status).toBe(200);
    }
    expect((await handler(new Request('http://localhost/health'))).status).toBe(200);
  } finally {
    await dispose();
  }
});

test('refuses an empty token', () => {
  expect(() => bearerAuth('')).toThrow('API_AUTH_TOKEN');
});

test('auth wraps HttpApiBuilder endpoints before their handlers execute', async () => {
  const group = HttpApiGroup.make('protected').add(
    HttpApiEndpoint.get('users', '/api/users', { success: Schema.String }),
  );
  const api = HttpApi.make('auth-test').add(group);
  let calls = 0;
  const handlers = HttpApiBuilder.group(api, 'protected', (h) =>
    h.handle('users', () =>
      Effect.sync(() => {
        calls++;
        return 'users';
      }),
    ),
  );
  const routes = HttpApiBuilder.layer(api).pipe(
    Layer.provide(bearerAuth(token)),
    Layer.provide(handlers),
    Layer.provide(BunHttpServer.layerHttpServices),
  );
  const { handler, dispose } = HttpRouter.toWebHandler(routes, { disableLogger: true });
  try {
    expect((await handler(new Request('http://localhost/api/users'))).status).toBe(401);
    expect(calls).toBe(0);
    expect(
      (
        await handler(
          new Request('http://localhost/api/users', {
            headers: { authorization: `Bearer ${token}` },
          }),
        )
      ).status,
    ).toBe(200);
    expect(calls).toBe(1);
  } finally {
    await dispose();
  }
});
