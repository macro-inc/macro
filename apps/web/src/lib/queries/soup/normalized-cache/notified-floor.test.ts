import { afterEach, describe, expect, it } from 'vitest';
import {
  clearNotifiedFloors,
  raiseNotifiedFloor,
  resolveNotifiedAt,
} from './notified-floor';

afterEach(() => {
  clearNotifiedFloors();
});

describe('notified floors', () => {
  it('passes the server value through when no floor exists', () => {
    expect(resolveNotifiedAt('e-1', '2026-09-02T00:00:00Z')).toBe(
      '2026-09-02T00:00:00Z'
    );
    expect(resolveNotifiedAt('e-1', null)).toBeNull();
  });

  it('wins over an older or absent server value', () => {
    raiseNotifiedFloor('e-1', '2026-09-02T17:00:00Z');

    // A notified page that was in flight when the notification landed
    // returns the previous stamp (or none) — the delivered one must hold.
    expect(resolveNotifiedAt('e-1', '2026-09-01T00:00:00Z')).toBe(
      '2026-09-02T17:00:00Z'
    );
    expect(resolveNotifiedAt('e-1', null)).toBe('2026-09-02T17:00:00Z');
  });

  it('keeps the newest delivery when notifications arrive out of order', () => {
    raiseNotifiedFloor('e-1', '2026-09-02T17:00:00Z');
    raiseNotifiedFloor('e-1', '2026-09-02T16:00:00Z');

    expect(resolveNotifiedAt('e-1', null)).toBe('2026-09-02T17:00:00Z');
  });

  it('clears once the server catches up', () => {
    raiseNotifiedFloor('e-1', '2026-09-02T17:00:00Z');

    expect(resolveNotifiedAt('e-1', '2026-09-02T17:00:00.000123Z')).toBe(
      '2026-09-02T17:00:00.000123Z'
    );
    // The floor is gone: subsequent reads are pass-through.
    expect(resolveNotifiedAt('e-1', '2026-09-01T00:00:00Z')).toBe(
      '2026-09-01T00:00:00Z'
    );
  });
});
