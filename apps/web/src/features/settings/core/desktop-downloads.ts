export type DesktopPlatform = 'macos' | 'linux';

export const DESKTOP_PLATFORMS: readonly DesktopPlatform[] = ['macos', 'linux'];

/**
 * The website's stable installer links, the same ones its `/download` page
 * uses: the edge redirects each to the current release's installer
 * (`apps/marketing/seo/download-redirects.json`).
 */
export const DESKTOP_DOWNLOAD_URLS: Record<DesktopPlatform, string> = {
  macos: 'https://macro.com/download/mac',
  linux: 'https://macro.com/download/linux',
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
