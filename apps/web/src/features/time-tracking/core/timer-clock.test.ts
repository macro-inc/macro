import { describe, expect, it } from 'vitest';
import {
  elapsedSeconds,
  formatClock,
  formatCompactClock,
  serverOffset,
} from './timer-clock';

describe('elapsedSeconds', () => {
  it('counts whole seconds since the start', () => {
    const start = '2026-11-23T10:02:00.000Z';
    expect(elapsedSeconds(start, Date.parse(start) + 2_530_900)).toBe(2530);
  });

  it('never goes below zero when the device clock is behind', () => {
    const start = '2026-11-23T10:02:00.000Z';
    expect(elapsedSeconds(start, Date.parse(start) - 5_000)).toBe(0);
  });
});

describe('serverOffset', () => {
  it('is how far the server is ahead of the device', () => {
    const received = Date.parse('2026-11-23T10:00:00.000Z');
    expect(serverOffset('2026-11-23T10:00:03.000Z', received)).toBe(3_000);
    expect(serverOffset('2026-11-23T09:59:58.000Z', received)).toBe(-2_000);
  });

  it('is zero for a time it cannot read', () => {
    expect(serverOffset('not a time', 0)).toBe(0);
  });
});

describe('formatClock', () => {
  it.each([
    [0, '0:00:00'],
    [2530, '0:42:10'],
    [3600, '1:00:00'],
    [51_605, '14:20:05'],
  ])('%i seconds read %s', (seconds, text) => {
    expect(formatClock(seconds)).toBe(text);
  });
});

describe('formatCompactClock', () => {
  it.each([
    [5, '0:05'],
    [2530, '42:10'],
    [3599, '59:59'],
    [3600, '1:00:00'],
    [6130, '1:42:10'],
  ])('%i seconds read %s', (seconds, text) => {
    expect(formatCompactClock(seconds)).toBe(text);
  });
});
