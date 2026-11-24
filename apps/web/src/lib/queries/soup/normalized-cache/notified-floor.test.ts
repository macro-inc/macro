import { createComputed, createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearNotifiedFloors,
  raiseNotifiedFloor,
  resolveNotifiedAt,
  trackNotifiedFloor,
} from './notified-floor';

afterEach(() => {
  clearNotifiedFloors();
  vi.useRealTimers();
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

  it('survives optimistic reads and older responses arriving after a fresh snapshot', () => {
    raiseNotifiedFloor('e-1', '2026-09-02T17:00:00Z');

    // Mapping the local write must not acknowledge it as server confirmation.
    expect(resolveNotifiedAt('e-1', '2026-09-02T17:00:00Z')).toBe(
      '2026-09-02T17:00:00Z'
    );
    expect(resolveNotifiedAt('e-1', '2026-09-02T17:00:00.000123Z')).toBe(
      '2026-09-02T17:00:00.000123Z'
    );
    expect(resolveNotifiedAt('e-1', '2026-09-01T00:00:00Z')).toBe(
      '2026-09-02T17:00:00Z'
    );
  });

  it('expires without duplicate or older deliveries extending retention', () => {
    vi.useFakeTimers();
    raiseNotifiedFloor('e-1', '2026-09-02T17:00:00Z');
    vi.advanceTimersByTime(4 * 60 * 1000);
    raiseNotifiedFloor('e-1', '2026-09-02T17:00:00Z');
    raiseNotifiedFloor('e-1', '2026-09-02T16:00:00Z');
    expect(resolveNotifiedAt('e-1', null)).toBe('2026-09-02T17:00:00Z');
    vi.advanceTimersByTime(60 * 1000);
    expect(resolveNotifiedAt('e-1', null)).toBeNull();
  });

  it("re-runs only a computation that tracks an entity's floor when it rises", () => {
    const seen: (string | null | undefined)[] = [];
    let resolvedOnly = 0;
    const dispose = createRoot((dispose) => {
      createComputed(() => {
        trackNotifiedFloor('e-1');
        seen.push(resolveNotifiedAt('e-1', '2026-09-02T00:00:00Z'));
      });
      // A selector mapping a whole list resolves without tracking, so a
      // delivery does not map the list again.
      createComputed(() => {
        resolveNotifiedAt('e-1', '2026-09-02T00:00:00Z');
        resolvedOnly += 1;
      });
      return dispose;
    });
    try {
      raiseNotifiedFloor('other', '2026-09-02T18:00:00Z');
      raiseNotifiedFloor('e-1', '2026-09-02T17:00:00Z');
      // An older delivery leaves the floor, and so the reader, alone.
      raiseNotifiedFloor('e-1', '2026-09-02T16:00:00Z');
      expect(seen).toEqual(['2026-09-02T00:00:00Z', '2026-09-02T17:00:00Z']);
      expect(resolvedOnly).toBe(1);
    } finally {
      dispose();
    }
  });

  it('bounds retained stamps and keeps the most recently advanced entities', () => {
    for (let i = 0; i < 200; i++) {
      raiseNotifiedFloor(`e-${i}`, '2026-09-02T16:00:00Z');
    }
    raiseNotifiedFloor('e-0', '2026-09-02T17:00:00Z');
    raiseNotifiedFloor('new', '2026-09-02T17:00:00Z');
    expect(resolveNotifiedAt('e-1', null)).toBeNull();
    expect(resolveNotifiedAt('e-0', null)).toBe('2026-09-02T17:00:00Z');
    expect(resolveNotifiedAt('new', null)).toBe('2026-09-02T17:00:00Z');
  });
});
