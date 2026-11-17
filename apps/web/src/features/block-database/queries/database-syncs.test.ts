import type { DatabaseSync } from '@service-cognition/generated/schemas/databaseSync';
import { describe, expect, it, vi } from 'vitest';
import { type AwaitedRun, syncListPollInterval } from './database-syncs';

vi.mock('@service-cognition/database-syncs', () => ({
  databaseSyncsClient: {},
}));

const synced: DatabaseSync = {
  id: 'sync-1',
  databaseId: 'database-1',
  tableId: 'table-1',
  createdAt: '2026-11-01T00:00:00Z',
  createdBy: 'macro|owner@example.com',
  source: { kind: 'granola_meetings' },
  columns: [],
  detachedColumns: [],
  lastSyncedAt: '2026-11-01T00:00:00Z',
  status: { state: 'synced' },
};

describe('syncListPollInterval', () => {
  it('keeps reading after a run request until the sync reads differently', () => {
    const awaited = new Map<string, AwaitedRun>([
      [
        synced.id,
        {
          before: JSON.stringify([synced.lastSyncedAt, synced.status]),
          until: 60_000,
        },
      ],
    ]);

    expect(syncListPollInterval([synced], awaited, 1_000)).toBe(3000);
    expect(
      syncListPollInterval(
        [{ ...synced, lastSyncedAt: '2026-11-01T00:05:00Z' }],
        awaited,
        2_000
      )
    ).toBe(false);
    expect(awaited.size).toBe(0);
  });

  it('stops waiting for a run that never shows', () => {
    const awaited = new Map<string, AwaitedRun>([
      [
        synced.id,
        {
          before: JSON.stringify([synced.lastSyncedAt, synced.status]),
          until: 60_000,
        },
      ],
    ]);

    expect(syncListPollInterval([synced], awaited, 60_000)).toBe(false);
    expect(awaited.size).toBe(0);
  });

  it('reads a list with a sync that has not run yet', () => {
    expect(
      syncListPollInterval(
        [{ ...synced, lastSyncedAt: null, status: { state: 'pending' } }],
        new Map(),
        0
      )
    ).toBe(3000);
  });
});
