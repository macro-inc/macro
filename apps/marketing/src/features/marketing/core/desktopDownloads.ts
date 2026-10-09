export const DESKTOP_RELEASE_URL =
  'https://github.com/macro-inc/macro/releases';
export const DESKTOP_RELEASE_API_URL =
  'https://api.github.com/repos/macro-inc/macro/releases?per_page=100';

export type DesktopPlatform = 'macos' | 'linux';

export type DesktopDownloadUrls = Record<DesktopPlatform, string>;

export function detectDesktopPlatform(userAgent: string): DesktopPlatform {
  return /linux/i.test(userAgent) && !/android|cros/i.test(userAgent)
    ? 'linux'
    : 'macos';
}

export function desktopReleaseVersion(downloadUrl: string): string | undefined {
  return downloadUrl.match(/\/releases\/download\/([^/]+)\//)?.[1];
}

export const FALLBACK_DOWNLOAD_URLS: DesktopDownloadUrls = {
  macos:
    'https://github.com/macro-inc/macro/releases/download/v2026.10.6.0/Macro-2.5.0-aarch64-darwin.dmg',
  linux:
    'https://github.com/macro-inc/macro/releases/download/v2026.10.6.0/Macro-2.5.0-x86_64-linux.AppImage',
};

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GithubRelease {
  draft?: boolean;
  prerelease?: boolean;
  assets?: ReleaseAsset[];
}

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
