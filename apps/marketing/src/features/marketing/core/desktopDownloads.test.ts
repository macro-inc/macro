import { describe, expect, it } from 'vitest';
import downloadRedirects from '../../../../seo/download-redirects.json';
import {
  DESKTOP_DOWNLOAD_URLS,
  DESKTOP_PLATFORMS,
  desktopPlatformOrder,
  detectPhonePlatform,
  detectVisitorPlatform,
  phonePlatformOrder,
} from './desktopDownloads';

describe('DESKTOP_DOWNLOAD_URLS', () => {
  it('links every platform to an edge redirect', () => {
    for (const platform of DESKTOP_PLATFORMS)
      expect(Object.keys(downloadRedirects)).toContain(
        DESKTOP_DOWNLOAD_URLS[platform]
      );
  });
});

describe('detectVisitorPlatform', () => {
  it.each([
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'macos'],
    ['Mozilla/5.0 (X11; Linux x86_64)', 'linux'],
    ['Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:131.0)', 'linux'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'windows'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8)', undefined],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', undefined],
    ['Mozilla/5.0 (X11; CrOS x86_64)', undefined],
    ['', undefined],
  ])('detects %s', (userAgent, platform) => {
    expect(detectVisitorPlatform(userAgent)).toBe(platform);
  });
});

describe('phone platforms', () => {
  it.each([
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'ios'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8)', 'android'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', undefined],
    ['Mozilla/5.0 (X11; Linux x86_64)', undefined],
  ])('detects %s', (userAgent, platform) => {
    expect(detectPhonePlatform(userAgent)).toBe(platform);
  });

  it('lists the visitor phone first, iOS by default', () => {
    expect(phonePlatformOrder('android')).toEqual(['android', 'ios']);
    expect(phonePlatformOrder('ios')).toEqual(['ios', 'android']);
    expect(phonePlatformOrder(undefined)).toEqual(['ios', 'android']);
  });
});

describe('desktopPlatformOrder', () => {
  it('lists the visitor platform first', () => {
    expect(desktopPlatformOrder('linux')).toEqual(['linux', 'macos']);
    expect(desktopPlatformOrder('macos')).toEqual(['macos', 'linux']);
  });

  it('keeps the default order for other platforms', () => {
    for (const visitor of ['windows', undefined] as const)
      expect(desktopPlatformOrder(visitor)).toEqual(['macos', 'linux']);
  });
});
