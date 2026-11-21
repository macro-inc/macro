import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sinceLabel } from './waiting';

describe('sinceLabel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-09T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('counts whole days, hours and minutes, and says now under a minute', () => {
    expect(sinceLabel('2026-11-07T11:00:00Z')).toBe('2 days');
    expect(sinceLabel('2026-11-09T09:30:00Z')).toBe('2 hours');
    expect(sinceLabel('2026-11-09T11:00:00Z')).toBe('1 hour');
    expect(sinceLabel('2026-11-09T11:48:00Z')).toBe('12 min');
    expect(sinceLabel('2026-11-09T11:59:40Z')).toBe('now');
  });
});
