import { describe, expect, it } from 'vitest';
import { detectDesktopPlatform } from './desktop-downloads';

describe('detectDesktopPlatform', () => {
  it.each([
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'macos'],
    ['Mozilla/5.0 (X11; Linux x86_64)', 'linux'],
    ['Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:131.0)', 'linux'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8)', undefined],
    ['Mozilla/5.0 (X11; CrOS x86_64)', undefined],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', undefined],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', undefined],
    ['', undefined],
  ])('reads %s as %s', (userAgent, platform) => {
    expect(detectDesktopPlatform(userAgent)).toBe(platform);
  });
});
