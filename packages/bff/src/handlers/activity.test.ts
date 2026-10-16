import { describe, expect, mock, test } from 'bun:test';
import type { ActivityEntry } from '@google-github-sync/shared/api';

// The helper is pure; stub the DB client so importing the handler module needs no env config
mock.module('../db', () => ({ db: {} }));

const { mergeActivityPage } = await import('./activity');

function entry(id: string, minute: number): ActivityEntry {
  return {
    id,
    type: id.startsWith('sync') ? 'sync' : 'action',
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString(),
    trigger: 'test',
    summary: id,
    details: {},
  };
}

// Each feed arrives newest-first, as the DB queries return it; the two feeds interleave
const sync = [entry('sync-3', 50), entry('sync-2', 30), entry('sync-1', 10)];
const action = [entry('action-3', 60), entry('action-2', 40), entry('action-1', 20)];
const newestFirst = ['action-3', 'sync-3', 'action-2', 'sync-2', 'action-1', 'sync-1'];

const ids = (entries: ActivityEntry[]) => entries.map((e) => e.id);

describe('mergeActivityPage', () => {
  test('returns the newest entries across both feeds, newest first', () => {
    expect(ids(mergeActivityPage(sync, action, 1, 4))).toEqual(newestFirst.slice(0, 4));
  });

  test('consecutive pages cover the merged timeline with no duplicates or gaps', () => {
    const pages = [1, 2, 3].flatMap((page) => ids(mergeActivityPage(sync, action, page, 2)));
    expect(pages).toEqual(newestFirst);
  });

  test('returns a partial last page', () => {
    // 5 entries: action-3, sync-3, action-2, sync-2, action-1
    expect(ids(mergeActivityPage(sync.slice(0, 2), action, 3, 2))).toEqual(['action-1']);
  });

  test('returns nothing past the end', () => {
    expect(mergeActivityPage(sync, action, 4, 2)).toEqual([]);
  });
});
