import { describe, expect, it } from 'vitest';
import { tabCounts, waitingFor } from './suggestion';

describe('tabCounts', () => {
  it('counts a failed run with the running ones and sums All', () => {
    expect(tabCounts({ open: 4, running: 1, failed: 2, done: 3 })).toEqual({
      all: 10,
      running: 3,
      open: 4,
      done: 3,
    });
  });
});

describe('waitingFor', () => {
  const now = new Date('2026-11-09T09:30:00Z');

  it('counts whole days, then hours, and nothing under an hour', () => {
    expect(waitingFor('2026-11-07T09:00:00Z', now)).toEqual({
      unit: 'days',
      count: 2,
    });
    expect(waitingFor('2026-11-09T04:00:00Z', now)).toEqual({
      unit: 'hours',
      count: 5,
    });
    expect(waitingFor('2026-11-09T09:00:00Z', now)).toBeUndefined();
    expect(waitingFor('not a date', now)).toBeUndefined();
  });
});
