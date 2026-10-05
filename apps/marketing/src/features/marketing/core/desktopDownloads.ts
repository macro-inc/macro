export const DESKTOP_RELEASE_URL =
  'https://github.com/macro-inc/macro/releases/latest';
export const DESKTOP_RELEASE_API_URL =
  'https://api.github.com/repos/macro-inc/macro/releases/latest';

export type DesktopPlatform = 'macos' | 'linux';

export type DesktopDownloadUrls = Record<DesktopPlatform, string>;

export const FALLBACK_DOWNLOAD_URLS: DesktopDownloadUrls = {
  macos: DESKTOP_RELEASE_URL,
  linux: DESKTOP_RELEASE_URL,
};

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GithubRelease {
  assets?: ReleaseAsset[];
}

export function releaseDownloadUrls(
  release: GithubRelease
): DesktopDownloadUrls {
  const assets = release.assets ?? [];
  const findAsset = (suffix: string) =>
    assets.find(
      (asset) => asset.name.startsWith('Macro-') && asset.name.endsWith(suffix)
    )?.browser_download_url;

  return {
    macos: findAsset('-aarch64-darwin.dmg') ?? DESKTOP_RELEASE_URL,
    linux: findAsset('-x86_64-linux.AppImage') ?? DESKTOP_RELEASE_URL,
  };
}
