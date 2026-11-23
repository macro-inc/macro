import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  desktopPlatformOrder,
  desktopReleaseVersion,
  detectPhonePlatform,
  detectVisitorPlatform,
  FALLBACK_DOWNLOAD_URLS,
  fetchDesktopDownloadUrls,
  phonePlatformOrder,
  releaseDownloadUrls,
} from './desktopDownloads';

const macos = {
  name: 'Macro-2.5.0-aarch64-darwin.dmg',
  browser_download_url: 'https://example.com/mac.dmg',
};
const linux = {
  name: 'Macro-2.5.0-x86_64-linux.AppImage',
  browser_download_url: 'https://example.com/linux.AppImage',
};

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

describe('fetchDesktopDownloadUrls', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads installers from the releases API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json([{ assets: [macos, linux] }]))
    );
    await expect(fetchDesktopDownloadUrls()).resolves.toEqual({
      macos: macos.browser_download_url,
      linux: linux.browser_download_url,
    });
  });

  it('falls back to verified installers when GitHub fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('rate limited', { status: 403 }))
    );
    await expect(fetchDesktopDownloadUrls()).resolves.toEqual(
      FALLBACK_DOWNLOAD_URLS
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('offline');
      })
    );
    await expect(fetchDesktopDownloadUrls()).resolves.toEqual(
      FALLBACK_DOWNLOAD_URLS
    );
  });
});

describe('desktopReleaseVersion', () => {
  it('uses the selected installer release, including fallback installers', () => {
    expect(desktopReleaseVersion(FALLBACK_DOWNLOAD_URLS.macos)).toBe(
      'v2026.11.19.1'
    );
    expect(
      desktopReleaseVersion(
        'https://github.com/macro-inc/macro/releases/download/v2026.10.7.0/Macro-2.5.0-x86_64-linux.AppImage'
      )
    ).toBe('v2026.10.7.0');
    expect(
      desktopReleaseVersion('https://example.com/mac.dmg')
    ).toBeUndefined();
  });
});

describe('releaseDownloadUrls', () => {
  it('finds desktop installers behind a newer CLI-only release', () => {
    expect(
      releaseDownloadUrls([
        {
          assets: [
            {
              name: 'macrod-v2026.10.6.1-macos-aarch64.tar.gz',
              browser_download_url: 'https://example.com/cli.tar.gz',
            },
          ],
        },
        { assets: [macos, linux] },
      ])
    ).toEqual({
      macos: macos.browser_download_url,
      linux: linux.browser_download_url,
    });
  });

  it('selects each platform independently during partial uploads', () => {
    expect(
      releaseDownloadUrls([
        { assets: [macos] },
        {
          assets: [
            { ...macos, browser_download_url: 'https://example.com/old.dmg' },
            linux,
          ],
        },
      ])
    ).toEqual({
      macos: macos.browser_download_url,
      linux: linux.browser_download_url,
    });
  });

  it('excludes draft and prerelease installers', () => {
    expect(
      releaseDownloadUrls([
        { draft: true, assets: [macos, linux] },
        { prerelease: true, assets: [macos, linux] },
      ])
    ).toEqual(FALLBACK_DOWNLOAD_URLS);
  });

  it('keeps direct installer fallbacks when assets are missing', () => {
    expect(releaseDownloadUrls([])).toEqual(FALLBACK_DOWNLOAD_URLS);
    expect(releaseDownloadUrls([{}, { assets: [linux] }])).toEqual({
      macos: FALLBACK_DOWNLOAD_URLS.macos,
      linux: linux.browser_download_url,
    });
    expect(FALLBACK_DOWNLOAD_URLS.macos).toMatch(/\/download\/.*\.dmg$/);
    expect(FALLBACK_DOWNLOAD_URLS.linux).toMatch(/\/download\/.*\.AppImage$/);
  });
});
