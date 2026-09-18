import { describe, expect, it } from 'vitest';
import { compactAge, relativeAge } from './format-age';

const NOW = Date.parse('2026-09-15T12:00:00Z');
const ago = (ms: number) => NOW - ms;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('compactAge', () => {
  it('is empty for an unknown time', () => {
    expect(compactAge(0, NOW)).toBe('');
  });

  it('steps through seconds, minutes, hours, and days', () => {
    expect(compactAge(ago(20_000), NOW)).toBe('now');
    expect(compactAge(ago(4 * MINUTE), NOW)).toBe('4m');
    expect(compactAge(ago(3 * HOUR), NOW)).toBe('3h');
    expect(compactAge(ago(2 * DAY), NOW)).toBe('2d');
  });

  it('falls back to a short date after a week', () => {
    expect(compactAge(ago(10 * DAY), NOW)).toBe('Sep 5');
  });
});

describe('relativeAge', () => {
  it('spells the age out', () => {
    expect(relativeAge(ago(5_000), NOW)).toBe('just now');
    expect(relativeAge(ago(25 * MINUTE), NOW)).toBe('25 min ago');
    expect(relativeAge(ago(2 * HOUR), NOW)).toBe('2 h ago');
    expect(relativeAge(ago(12 * DAY), NOW)).toBe('12 d ago');
    expect(relativeAge(ago(45 * DAY), NOW)).toBe('Aug 1');
  });
});
