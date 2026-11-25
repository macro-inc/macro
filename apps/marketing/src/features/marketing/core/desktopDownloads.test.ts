import { describe, expect, it } from 'vitest';
import downloadRedirects from '../../../../seo/download-redirects.json';
import {
  DESKTOP_DOWNLOAD_URLS,
  DESKTOP_PLATFORMS,
  detectPhonePlatform,
  detectVisitorPlatform,
  installerLabel,
  installerPlatform,
  intelMacPublished,
  phonePlatformOrder,
  publishedInstallers,
  readMacArchitecture,
  visitorInstaller,
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
    ['Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)', undefined],
    ['', undefined],
  ])('detects %s', (userAgent, platform) => {
    expect(detectVisitorPlatform(userAgent)).toBe(platform);
  });
});

describe('iPad', () => {
  // iPadOS Safari's default, desktop-class user agent.
  const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';

  it('is a phone platform, not a Mac, when the screen is touch', () => {
    expect(detectVisitorPlatform(IPAD, 5)).toBeUndefined();
    expect(detectPhonePlatform(IPAD, 5)).toBe('ios');
    expect(detectVisitorPlatform(IPAD, 0)).toBe('macos');
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

describe('installerPlatform', () => {
  it('names the installer for a computer Macro publishes one for', () => {
    expect(installerPlatform('macos')).toBe('macos');
    expect(installerPlatform('linux')).toBe('linux');
  });

  it('has none for other computers', () => {
    for (const visitor of ['windows', undefined] as const)
      expect(installerPlatform(visitor)).toBeUndefined();
  });
});

describe('Intel Mac installer', () => {
  it('is offered only once the edge links to it', () => {
    // Add /download/mac-intel only after a release has published the Intel
    // installer, and update this line with it.
    expect(intelMacPublished(downloadRedirects)).toBe(false);
    expect(intelMacPublished({ '/download/mac': 'a' })).toBe(false);
    expect(
      intelMacPublished({ '/download/mac': 'a', '/download/mac-intel': 'b' })
    ).toBe(true);
    expect(publishedInstallers(false)).toEqual(['macos', 'linux']);
    expect(publishedInstallers(true)).toEqual([
      'macos',
      'macos-intel',
      'linux',
    ]);
  });

  it('is the Mac visitor installer only when the browser reports Intel', () => {
    expect(visitorInstaller('macos', 'x86', true)).toBe('macos-intel');
    expect(visitorInstaller('macos', 'arm', true)).toBe('macos');
    expect(visitorInstaller('macos', undefined, true)).toBe('macos');
    expect(visitorInstaller('macos', 'x86', false)).toBe('macos');
    expect(visitorInstaller('linux', 'x86', true)).toBe('linux');
  });

  it('names both Mac installers by chip, and as a Mac off one', () => {
    expect(installerLabel('macos', false, true)).toBe('macOS');
    expect(installerLabel('macos', true, true)).toBe('Apple silicon');
    expect(installerLabel('macos-intel', true, true)).toBe('Intel');
    expect(installerLabel('macos', true, false)).toBe('Mac (Apple silicon)');
    expect(installerLabel('macos-intel', true, false)).toBe('Mac (Intel)');
    expect(installerLabel('linux', true, false)).toBe('Linux');
  });

  it("reads the architecture only from Chromium's hint", async () => {
    const answering = (value: Promise<{ architecture?: string }>) => ({
      getHighEntropyValues: () => value,
    });
    expect(
      await readMacArchitecture(
        answering(Promise.resolve({ architecture: 'x86' }))
      )
    ).toBe('x86');
    expect(
      await readMacArchitecture(
        answering(Promise.resolve({ architecture: 'arm' }))
      )
    ).toBe('arm');
    expect(
      await readMacArchitecture(answering(Promise.resolve({})))
    ).toBeUndefined();
    expect(
      await readMacArchitecture(answering(Promise.reject(new Error('denied'))))
    ).toBeUndefined();
    expect(await readMacArchitecture(undefined)).toBeUndefined();
  });
});
