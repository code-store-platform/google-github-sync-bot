import { afterEach, beforeEach, expect, test } from 'bun:test';
import { authorizeDashboard } from './server-auth';
import { GET, POST } from '../app/api/[...path]/route';

const keys = [
  'DASHBOARD_USERNAME',
  'DASHBOARD_PASSWORD',
  'CORS_ORIGIN',
  'API_AUTH_TOKEN',
  'BFF_URL',
] as const;
let saved: (string | undefined)[];
const authorization = `Basic ${Buffer.from('admin:test-password-at-least-16').toString('base64')}`;
beforeEach(() => {
  saved = keys.map((key) => process.env[key]);
  process.env.DASHBOARD_USERNAME = 'admin';
  process.env.DASHBOARD_PASSWORD = 'test-password-at-least-16';
  process.env.API_AUTH_TOKEN = 'test-api-token-at-least-32-characters';
  process.env.CORS_ORIGIN = 'http://localhost:3001';
  process.env.BFF_URL = 'http://localhost:4000';
});
afterEach(() => {
  keys.forEach((key, index) => {
    const value = saved[index];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  });
});

test('requires valid credentials and fails closed when unconfigured', () => {
  const request = new Request('http://localhost:3001', { headers: { authorization } });
  expect(authorizeDashboard(request)).toBeUndefined();
  expect(authorizeDashboard(new Request(request.url))?.status).toBe(401);
  expect(
    authorizeDashboard(new Request(request.url, { headers: { authorization: 'Basic wrong' } }))
      ?.status,
  ).toBe(401);
  delete process.env.DASHBOARD_PASSWORD;
  expect(authorizeDashboard(request)?.status).toBe(503);
});

test('rejects cross-origin writes even with valid credentials', () => {
  for (const origin of ['https://attacker.example', 'null']) {
    const response = authorizeDashboard(
      new Request('http://localhost:3001/api/sync/github', {
        method: 'POST',
        headers: { authorization, origin },
      }),
    );
    expect(response?.status).toBe(403);
  }
  expect(
    authorizeDashboard(
      new Request('http://localhost:3001/api/sync/github', {
        method: 'POST',
        headers: { authorization, origin: 'http://localhost:3001' },
      }),
    ),
  ).toBeUndefined();
});

test('proxy independently rejects unauthenticated requests', async () => {
  expect((await GET(new Request('http://localhost:3001/api/users'))).status).toBe(401);
});

test('proxy forwards only server credentials and preserves path, query, body and status', async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async (url, init) => {
    called = true;
    expect(String(url)).toBe('http://localhost:4000/api/teams?check=1');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('authorization')).toBe(
      `Bearer ${process.env.API_AUTH_TOKEN}`,
    );
    expect(new Headers(init?.headers).has('cookie')).toBe(false);
    expect(init?.redirect).toBe('manual');
    expect(new TextDecoder().decode(init?.body as ArrayBuffer)).toBe('{"name":"test"}');
    return new Response('{"ok":true}', {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    const response = await POST(
      new Request('http://localhost:3001/api/teams?check=1', {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/json', cookie: 'private=cookie' },
        body: '{"name":"test"}',
      }),
    );
    expect(called).toBe(true);
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ ok: true });
  } finally {
    globalThis.fetch = original;
  }
});
