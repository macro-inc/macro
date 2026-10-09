import { describe, expect, it } from 'vitest';
import {
  desktopReleaseVersion,
  detectDesktopPlatform,
  FALLBACK_DOWNLOAD_URLS,
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

describe('detectDesktopPlatform', () => {
  it.each([
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'macos'],
    ['Mozilla/5.0 (X11; Linux x86_64)', 'linux'],
    ['Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:131.0)', 'linux'],
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8)', 'macos'],
    ['Mozilla/5.0 (X11; CrOS x86_64)', 'macos'],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'macos'],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'macos'],
    ['', 'macos'],
  ])('selects an installer for %s', (userAgent, platform) => {
    expect(detectDesktopPlatform(userAgent)).toBe(platform);
  });
});

describe('desktopReleaseVersion', () => {
  it('uses the selected installer release, including fallback installers', () => {
    expect(desktopReleaseVersion(FALLBACK_DOWNLOAD_URLS.macos)).toBe(
      'v2026.10.6.0'
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
