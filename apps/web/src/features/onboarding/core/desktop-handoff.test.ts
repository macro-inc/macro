import { describe, expect, it } from 'vitest';
import { phoneStorePlatform } from './desktop-handoff';

describe('phoneStorePlatform', () => {
  it.each([
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36',
      'android',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Version/18.1 Mobile/15E148 Safari/604.1',
      'ios',
    ],
    ['Mozilla/5.0 (X11; Linux x86_64)', 'ios'],
  ])('%s installs from %s', (userAgent, platform) => {
    expect(phoneStorePlatform(userAgent)).toBe(platform);
  });
});
