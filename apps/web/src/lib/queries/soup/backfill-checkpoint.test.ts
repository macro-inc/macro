/**
 * @vitest-environment jsdom
 */

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  initialSoupBackfillCheckpoint,
  markSoupBackfillLaneFailed,
  saveSoupBackfillCheckpoint,
  soupBackfillLaneFailed,
  watchSoupBackfillCheckpoint,
} from './backfill-checkpoint';

const USER = 'macro|viewer@example.com';
const LANE = 'channel-directory';

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
