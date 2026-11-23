export const DESKTOP_RELEASE_URL =
  'https://github.com/macro-inc/macro/releases';
export const DESKTOP_RELEASE_API_URL =
  'https://api.github.com/repos/macro-inc/macro/releases?per_page=100';

export const IOS_APP_STORE_URL =
  'https://apps.apple.com/us/app/macro-app/id6743133649';
export const ANDROID_PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.macro.workspace.mobile';

/** Desktop platforms with published installers, in default display order. */
export const DESKTOP_PLATFORMS = ['macos', 'linux'] as const;

export type DesktopPlatform = (typeof DESKTOP_PLATFORMS)[number];

export type DesktopDownloadUrls = Record<DesktopPlatform, string>;

export const DESKTOP_PLATFORM_DETAILS: Record<
  DesktopPlatform,
  { label: string; requirement: string }
> = {
  macos: { label: 'macOS', requirement: 'macOS 15 or later, Apple silicon' },
  linux: { label: 'Linux', requirement: 'x86_64 AppImage' },
};

export type VisitorPlatform = DesktopPlatform | 'windows';

/** The visitor's desktop operating system; phones and others are undefined. */
export function detectVisitorPlatform(
  userAgent: string
): VisitorPlatform | undefined {
  if (/android|iphone|ipad|ipod|cros/i.test(userAgent)) return undefined;
  if (/macintosh|mac os x/i.test(userAgent)) return 'macos';
  if (/windows/i.test(userAgent)) return 'windows';
  if (/linux/i.test(userAgent)) return 'linux';
  return undefined;
}

/** Desktop installers with the visitor's own platform first. */
export function desktopPlatformOrder(
  visitor: VisitorPlatform | undefined
): DesktopPlatform[] {
  return [...DESKTOP_PLATFORMS].sort(
    (a, b) => Number(b === visitor) - Number(a === visitor)
  );
}

export function desktopReleaseVersion(downloadUrl: string): string | undefined {
  return downloadUrl.match(/\/releases\/download\/([^/]+)\//)?.[1];
}

/** Verified installers, used before and if the GitHub releases API answers. */
export const FALLBACK_DOWNLOAD_URLS: DesktopDownloadUrls = {
  macos:
    'https://github.com/macro-inc/macro/releases/download/v2026.11.19.1/Macro-2026.1119.1-aarch64-darwin.dmg',
  linux:
    'https://github.com/macro-inc/macro/releases/download/v2026.11.19.1/Macro-2026.1119.1-x86_64-linux.AppImage',
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

/** Latest stable installer URLs; the verified fallbacks if GitHub fails. */
export async function fetchDesktopDownloadUrls(
  signal?: AbortSignal
): Promise<DesktopDownloadUrls> {
  try {
    const response = await fetch(DESKTOP_RELEASE_API_URL, {
      headers: { Accept: 'application/vnd.github+json' },
      signal,
    });
    if (!response.ok) return FALLBACK_DOWNLOAD_URLS;
    return releaseDownloadUrls(await response.json());
  } catch {
    // Keep direct installer links usable if GitHub is unavailable or rate-limited.
    return FALLBACK_DOWNLOAD_URLS;
  }
}
