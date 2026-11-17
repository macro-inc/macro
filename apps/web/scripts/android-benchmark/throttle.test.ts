import { describe, expect, it } from 'vitest';
import { parseCpuThrottle, throttleInForce } from './throttle';

describe('parseCpuThrottle', () => {
  it('reads one rate or a list', () => {
    expect(parseCpuThrottle('4')).toEqual([4]);
    expect(parseCpuThrottle('1, 4')).toEqual([1, 4]);
    expect(parseCpuThrottle('2.5')).toEqual([2.5]);
  });

  it('rejects rates the check cannot verify, junk and repeats', () => {
    for (const value of ['', '0.5', '0', '1.5', '21', 'four', '0x4', '1,', '4,4'])
      expect(() => parseCpuThrottle(value)).toThrow();
  });
});

describe('throttleInForce', () => {
  it('accepts a slowdown near the rate, or above it under host load', () => {
    expect(throttleInForce(4, 4.3)).toBe(true);
    expect(throttleInForce(4, 2.2)).toBe(true);
    expect(throttleInForce(4, 7.5)).toBe(true);
    expect(throttleInForce(2, 1.6)).toBe(true);
  });

  it('rejects a throttle that lapsed', () => {
    // Throttling lost between steps: the page runs at full speed.
    expect(throttleInForce(4, 1.05)).toBe(false);
    expect(throttleInForce(4, 1.9)).toBe(false);
    expect(throttleInForce(2, 1.2)).toBe(false);
  });

  it('never fails the unthrottled profile on a loaded host', () => {
    expect(throttleInForce(1, 1.8)).toBe(true);
  });
});
