import { expect, test } from 'bun:test';
import { listAllGoogleUsers } from './google-pagination';

test('collects every page, including users after the first 300', async () => {
  const tokens: (string | undefined)[] = [];
  const users = await listAllGoogleUsers(async (token) => {
    tokens.push(token);
    if (!token)
      return { users: Array.from({ length: 300 }, (_, id) => ({ id })), nextPageToken: 'page2' };
    if (token === 'page2') return { users: [{ id: 300 }], nextPageToken: 'page3' };
    return {};
  });
  expect(users).toHaveLength(301);
  expect(users[300]).toEqual({ id: 300 });
  expect(tokens).toEqual([undefined, 'page2', 'page3']);
});

test('rejects the whole snapshot when a later page fails', async () => {
  const result = listAllGoogleUsers(async (token) => {
    if (token) throw new Error('Google unavailable');
    return { users: [{ id: 1 }], nextPageToken: 'page2' };
  });
  await expect(result).rejects.toThrow('Google unavailable');
});

test('rejects repeated tokens instead of looping or returning a partial snapshot', async () => {
  await expect(listAllGoogleUsers(async () => ({ nextPageToken: 'same' }))).rejects.toThrow(
    'repeated page token',
  );
});
