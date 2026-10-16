import { expect, test } from 'bun:test';
import { api } from './api-client';

test('uses the same-origin proxy without trace headers or BFF secrets', async () => {
  const original = globalThis.fetch;
  const requests: { url: string; headers: Headers }[] = [];
  globalThis.fetch = (async (url, init) => {
    requests.push({ url: String(url), headers: new Headers(init?.headers) });
    return new Response('[]', { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  try {
    await api.getUsers();
    expect(requests[0].url).toBe('http://localhost:3001/api/users');
    for (const header of ['b3', 'traceparent', 'authorization']) {
      expect(requests[0].headers.has(header)).toBe(false);
    }
  } finally {
    globalThis.fetch = original;
  }
});
