/**
 * Desktop installer links, resolved the same way as the marketing download
 * page (`apps/marketing/src/features/marketing/core/desktopDownloads.ts`):
 * the newest stable GitHub release that carries each installer, with pinned
 * fallbacks when GitHub can't be reached.
 */

export type DesktopPlatform = 'macos' | 'linux';

type DesktopDownloadUrls = Record<DesktopPlatform, string>;

export const DESKTOP_PLATFORMS: readonly DesktopPlatform[] = ['macos', 'linux'];

export const FALLBACK_DOWNLOAD_URLS: DesktopDownloadUrls = {
  macos:
    'https://github.com/macro-inc/macro/releases/download/v2026.11.6.1/Macro-2026.1106.1-aarch64-darwin.dmg',
  linux:
    'https://github.com/macro-inc/macro/releases/download/v2026.10.6.0/Macro-2.5.0-x86_64-linux.AppImage',
};

/**
 * The desktop platform this browser runs on, or undefined for one Macro has
 * no installer for (Windows, ChromeOS, phones).
 */
export function detectDesktopPlatform(
  userAgent: string
): DesktopPlatform | undefined {
  if (/android|cros/i.test(userAgent)) return undefined;
  if (/linux/i.test(userAgent)) return 'linux';
  if (/macintosh|mac os x/i.test(userAgent) && !/iphone|ipad/i.test(userAgent))
    return 'macos';
  return undefined;
}

type ReleaseAsset = {
  name: string;
  browser_download_url: string;
};

type GithubRelease = {
  draft?: boolean;
  prerelease?: boolean;
  assets?: ReleaseAsset[];
};

export function releaseDownloadUrls(
  releases: GithubRelease[]
): DesktopDownloadUrls {
  // CLI releases and desktop uploads can arrive separately. Find each installer
  // in the newest stable release that actually contains it.
  const assets = releases
    .filter((release) => !release.draft && !release.prerelease)
    .flatMap((release) => release.assets ?? []);

  const findAsset = (suffix: string) =>
    assets.find(
      (asset) => asset.name.startsWith('Macro-') && asset.name.endsWith(suffix)
    )?.browser_download_url;

  return {
    macos: findAsset('-aarch64-darwin.dmg') ?? FALLBACK_DOWNLOAD_URLS.macos,
    linux: findAsset('-x86_64-linux.AppImage') ?? FALLBACK_DOWNLOAD_URLS.linux,
  };
}
