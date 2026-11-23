import { describe, expect, it } from 'vitest';
import {
  detectDesktopPlatform,
  FALLBACK_DOWNLOAD_URLS,
  releaseDownloadUrls,
} from './desktop-downloads';

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
    ['Mozilla/5.0 (Linux; Android 14; Pixel 8)', undefined],
    ['Mozilla/5.0 (X11; CrOS x86_64)', undefined],
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', undefined],
    ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', undefined],
    ['', undefined],
  ])('reads %s as %s', (userAgent, platform) => {
    expect(detectDesktopPlatform(userAgent)).toBe(platform);
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

  it('keeps the pinned installers when assets are missing', () => {
    expect(releaseDownloadUrls([])).toEqual(FALLBACK_DOWNLOAD_URLS);
    expect(releaseDownloadUrls([{}, { assets: [linux] }])).toEqual({
      macos: FALLBACK_DOWNLOAD_URLS.macos,
      linux: linux.browser_download_url,
    });
    expect(FALLBACK_DOWNLOAD_URLS.macos).toMatch(/\/download\/.*\.dmg$/);
    expect(FALLBACK_DOWNLOAD_URLS.linux).toMatch(/\/download\/.*\.AppImage$/);
  });
});
