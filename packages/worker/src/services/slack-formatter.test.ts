import { describe, expect, test } from 'bun:test';
import { formatGitHubSyncMessage } from './slack-formatter';
import type { SyncResult } from './sync-engine';

describe('formatGitHubSyncMessage', () => {
  test('includes invited users block', () => {
    const result: SyncResult = {
      invited: [{ username: 'alice', email: 'alice@test.com' }],
      removed: [],
      errors: [],
    };

    const msg = formatGitHubSyncMessage(result);

    expect(msg.blocks.some((b) => b.text?.text?.includes('Invited users'))).toBe(true);
    expect(msg.blocks.some((b) => b.text?.text?.includes('alice'))).toBe(true);
  });

  test('includes removed users block', () => {
    const result: SyncResult = {
      invited: [],
      removed: ['bob'],
      errors: [],
    };

    const msg = formatGitHubSyncMessage(result);

    expect(msg.blocks.some((b) => b.text?.text?.includes('Removed users'))).toBe(true);
    expect(msg.blocks.some((b) => b.text?.text?.includes('bob'))).toBe(true);
  });

  test('includes errors block', () => {
    const result: SyncResult = {
      invited: [],
      removed: [],
      errors: ['Something failed'],
    };

    const msg = formatGitHubSyncMessage(result);

    expect(msg.blocks.some((b) => b.text?.text?.includes('Errors'))).toBe(true);
    expect(msg.blocks.some((b) => b.text?.text?.includes('Something failed'))).toBe(true);
  });

  test('empty result has only header and divider', () => {
    const result: SyncResult = { invited: [], removed: [], errors: [] };

    const msg = formatGitHubSyncMessage(result);

    expect(msg.blocks).toHaveLength(2); // header + divider
    expect(msg.blocks[0].type).toBe('header');
    expect(msg.blocks[1].type).toBe('divider');
  });
});
