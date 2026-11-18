import { describe, expect, it } from 'vitest';
import { storePlatform } from './storePlatform';

describe('storePlatform', () => {
  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 5, 'ios'],
    ['Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 5, 'ios'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5, 'ios'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0, undefined],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8)', 5, 'android'],
    ['Mozilla/5.0 (X11; Linux x86_64)', 0, undefined],
  ])('%s with %i touch points → %s', (userAgent, maxTouchPoints, expected) => {
    expect(storePlatform(userAgent, maxTouchPoints)).toBe(expected);
  });
});
