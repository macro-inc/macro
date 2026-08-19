import { afterEach, describe, expect, it } from 'vitest';
import {
  clearOwnTouchFloors,
  hasOwnTouchFloor,
  ownTouchStamp,
  resolveOwnTouch,
} from './own-touch';

afterEach(() => {
  clearOwnTouchFloors();
});

describe('own-touch floors', () => {
  it('passes the server value through when no floor exists', () => {
    expect(resolveOwnTouch('e-1', '2026-08-19T00:00:00Z')).toBe(
      '2026-08-19T00:00:00Z'
    );
    expect(resolveOwnTouch('e-1', null)).toBeNull();
  });

  it('wins over an older or absent server value', () => {
    const stamp = ownTouchStamp('e-1');

    // A touched refetch that outran the activity consumer returns the old
    // touched_at (or none) — the optimistic floor must hold.
    expect(resolveOwnTouch('e-1', '2020-01-01T00:00:00Z')).toBe(stamp);
    expect(resolveOwnTouch('e-1', null)).toBe(stamp);
    expect(hasOwnTouchFloor('e-1')).toBe(true);
  });

  it('clears once the server catches up', () => {
    ownTouchStamp('e-1');
    const caughtUp = new Date(Date.now() + 60_000).toISOString();

    expect(resolveOwnTouch('e-1', caughtUp)).toBe(caughtUp);
    // The floor is gone: subsequent reads are pass-through.
    expect(hasOwnTouchFloor('e-1')).toBe(false);
    expect(resolveOwnTouch('e-1', '2020-01-01T00:00:00Z')).toBe(
      '2020-01-01T00:00:00Z'
    );
  });

  it('compares timestamps numerically across precision differences', () => {
    // Server timestamps carry micros (chrono), the client stamps millis —
    // lexicographic comparison would misorder these.
    const stamp = ownTouchStamp('e-1');
    const equalWithMicros = `${stamp.slice(0, -1)}000Z`;
    expect(resolveOwnTouch('e-1', equalWithMicros)).toBe(equalWithMicros);
  });
});
