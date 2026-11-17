import { describe, expect, it } from 'vitest';
import { parseCpuThrottle, throttleInForce } from './throttle';

describe('parseCpuThrottle', () => {
  it('reads one rate or a list', () => {
    expect(parseCpuThrottle('4')).toEqual([4]);
    expect(parseCpuThrottle('1, 4')).toEqual([1, 4]);
    expect(parseCpuThrottle('2.5')).toEqual([2.5]);
  });

  it('rejects rates outside 1 to 20, junk and repeats', () => {
    for (const value of ['', '0.5', '0', '21', 'four', '1,', '4,4'])
      expect(() => parseCpuThrottle(value)).toThrow();
  });
});

describe('throttleInForce', () => {
  it('accepts a measured slowdown near the rate', () => {
    expect(throttleInForce(4, 4.3)).toBe(true);
    expect(throttleInForce(4, 3.1)).toBe(true);
    expect(throttleInForce(1, 1.2)).toBe(true);
  });

  it('rejects a lapsed or leftover throttle', () => {
    // Throttling lost between steps: the page runs at full speed.
    expect(throttleInForce(4, 1.05)).toBe(false);
    // A 4× throttle still in force when none was asked for.
    expect(throttleInForce(1, 4.1)).toBe(false);
    expect(throttleInForce(2, 4.2)).toBe(false);
  });
});
