/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  initialSoupBackfillCheckpoint,
  loadSoupBackfillCheckpoint,
  markSoupBackfillLaneFailed,
  saveSoupBackfillCheckpoint,
  soupBackfillLaneCompleted,
  soupBackfillLaneFailed,
  watchSoupBackfillCheckpoint,
} from './backfill-checkpoint';

const USER = 'macro|viewer@example.com';
const LANE = 'channel-directory-reconciled';

const stops: (() => void)[] = [];
beforeEach(() => localStorage.clear());
afterEach(() => {
  for (const stop of stops.splice(0)) stop();
});

it('marks a lane that gave up in one storage generation only', () => {
  markSoupBackfillLaneFailed(USER, LANE, 'g1');

  expect(soupBackfillLaneFailed(USER, LANE, 'g1')).toBe(true);
  expect(soupBackfillLaneFailed(USER, LANE, 'g2')).toBe(false);
  expect(soupBackfillLaneFailed(USER, 'other-lane', 'g1')).toBe(false);
});

it('clears the mark when the lane saves its next page', () => {
  markSoupBackfillLaneFailed(USER, LANE, 'g1');

  saveSoupBackfillCheckpoint(initialSoupBackfillCheckpoint(USER, 'g1'), LANE);

  expect(soupBackfillLaneFailed(USER, LANE, 'g1')).toBe(false);
});

it('keeps what storage refused for this tab to read', () => {
  const setItem = vi
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
  const onSave = vi.fn();
  stops.push(watchSoupBackfillCheckpoint(USER, LANE, onSave));
  try {
    saveSoupBackfillCheckpoint(
      {
        ...initialSoupBackfillCheckpoint(USER, 'g1'),
        completed: true,
        completedAt: '2026-11-20T00:00:00Z',
      },
      LANE
    );
    expect(soupBackfillLaneCompleted(USER, LANE, 'g1')).toBe(true);
    markSoupBackfillLaneFailed(USER, LANE, 'g2');
    expect(soupBackfillLaneFailed(USER, LANE, 'g2')).toBe(true);
    expect(onSave).toHaveBeenCalledTimes(2);
  } finally {
    setItem.mockRestore();
  }

  // Once storage takes a write, it answers again.
  saveSoupBackfillCheckpoint(initialSoupBackfillCheckpoint(USER, 'g2'), LANE);
  expect(soupBackfillLaneCompleted(USER, LANE, 'g1')).toBe(false);
  expect(soupBackfillLaneFailed(USER, LANE, 'g2')).toBe(false);
  expect(loadSoupBackfillCheckpoint(USER, LANE).storageGeneration).toBe('g2');
});

it("tells the lane's watchers, in this tab and in others", () => {
  const onSave = vi.fn();
  stops.push(watchSoupBackfillCheckpoint(USER, LANE, onSave));

  markSoupBackfillLaneFailed(USER, LANE, 'g1');
  expect(onSave).toHaveBeenCalledOnce();

  // Another tab's write arrives as a storage event naming the mark's key.
  const key = Object.keys(localStorage).find((name) =>
    name.endsWith(':failed')
  );
  window.dispatchEvent(new StorageEvent('storage', { key }));
  expect(onSave).toHaveBeenCalledTimes(2);
});
