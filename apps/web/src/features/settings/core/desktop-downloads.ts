import downloadRedirects from '@download-redirects';
import { ResultAsync } from 'neverthrow';
import { match } from 'ts-pattern';

/** A computer Macro ships a desktop app for. */
export type DesktopSystem = 'macos' | 'linux';

/** A desktop installer: one per system, and one per Mac architecture. */
export type DesktopPlatform = 'macos' | 'macos-intel' | 'linux';

/**
 * The website's stable installer links, the same ones its `/download` page
 * uses: the edge redirects each to the current release's installer
 * (`apps/marketing/seo/download-redirects.json`).
 */
export const DESKTOP_DOWNLOAD_URLS: Record<DesktopPlatform, string> = {
  macos: 'https://macro.com/download/mac',
  'macos-intel': 'https://macro.com/download/mac-intel',
  linux: 'https://macro.com/download/linux',
};

/**
 * Whether the website links to the Intel Mac installer. Releases publish it
 * only when they built it, so its redirect is added once one has; until then
 * an Intel link would lead nowhere.
 */
export function intelMacPublished(
  redirects: Record<string, string> = downloadRedirects
): boolean {
  return new URL(DESKTOP_DOWNLOAD_URLS['macos-intel']).pathname in redirects;
}

/**
 * The desktop system this browser runs on, or undefined for one Macro has
 * no installer for (Windows, ChromeOS, phones).
 */
export function detectDesktopPlatform(
  userAgent: string
): DesktopSystem | undefined {
  if (/android|cros/i.test(userAgent)) return undefined;
  if (/linux/i.test(userAgent)) return 'linux';
  if (/macintosh|mac os x/i.test(userAgent) && !/iphone|ipad/i.test(userAgent))
    return 'macos';
  return undefined;
}

export type MacArchitecture = 'arm' | 'x86';

/** `navigator.userAgentData`, which only Chromium browsers have. */
export interface UserAgentData {
  getHighEntropyValues(hints: string[]): Promise<{ architecture?: string }>;
}

/**
 * The Mac's processor, when the browser says. Every Mac browser's user agent
 * names Intel, so only Chromium's architecture hint tells the two apart;
 * Safari and Firefox leave it unknown.
 */
export async function readMacArchitecture(
  data: UserAgentData | undefined
): Promise<MacArchitecture | undefined> {
  if (!data) return undefined;
  // A browser could also throw before returning a promise.
  const values = await ResultAsync.fromThrowable(
    () => data.getHighEntropyValues(['architecture']),
    () => undefined
  )();
  if (values.isErr()) return undefined;
  const { architecture } = values.value;
  return architecture === 'arm' || architecture === 'x86'
    ? architecture
    : undefined;
}

/**
 * The installers to offer, the one for this computer first. A Mac's two
 * sit together, its own architecture first and Apple silicon when unknown;
 * Intel appears only once it is published.
 */
export function desktopInstallers(options: {
  system: DesktopSystem | undefined;
  architecture: MacArchitecture | undefined;
  intel: boolean;
}): DesktopPlatform[] {
  const mac = macInstallers(options.intel, options.architecture);
  return options.system === 'linux' ? ['linux', ...mac] : [...mac, 'linux'];
}

function macInstallers(
  intel: boolean,
  architecture: MacArchitecture | undefined
): DesktopPlatform[] {
  if (!intel) return ['macos'];
  return match(architecture)
    .with('x86', (): DesktopPlatform[] => ['macos-intel', 'macos'])
    .with('arm', undefined, (): DesktopPlatform[] => ['macos', 'macos-intel'])
    .exhaustive();
}
