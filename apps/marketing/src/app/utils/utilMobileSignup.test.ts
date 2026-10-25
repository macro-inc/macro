import { describe, expect, it } from 'vitest';
import { isIOS } from './utilMobileSignup';

describe('isIOS', () => {
  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 5, true],
    ['Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', 5, true],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5, true],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0, false],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8)', 5, false],
  ])('%s with %i touch points → %s', (userAgent, maxTouchPoints, expected) => {
    expect(isIOS(userAgent, maxTouchPoints)).toBe(expected);
  });
});
