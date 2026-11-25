import downloadRedirects from '../../../../seo/download-redirects.json';

export const DESKTOP_RELEASE_URL =
  'https://github.com/macro-inc/macro/releases';

export const IOS_APP_STORE_URL =
  'https://apps.apple.com/us/app/macro-app/id6743133649';
export const ANDROID_PLAY_STORE_URL =
  'https://play.google.com/store/apps/details?id=com.macro.workspace.mobile';

/** Desktop systems with published installers, in default display order. */
export const DESKTOP_PLATFORMS = ['macos', 'linux'] as const;

export type DesktopPlatform = (typeof DESKTOP_PLATFORMS)[number];

/** A desktop installer: one per system, and one per Mac architecture. */
export type DesktopInstaller = DesktopPlatform | 'macos-intel';

/**
 * Each installer's link. The edge redirects these to the current installer
 * (`seo/download-redirects.json`), so the page never names a version.
 */
export const DESKTOP_DOWNLOAD_URLS: Record<DesktopInstaller, string> = {
  macos: '/download/mac',
  'macos-intel': '/download/mac-intel',
  linux: '/download/linux',
};

export const DESKTOP_PLATFORM_DETAILS: Record<
  DesktopInstaller,
  { label: string; requirement: string }
> = {
  macos: {
    label: 'macOS',
    requirement:
      'Requires macOS 14 (Sonoma) or later on a Mac with Apple silicon.',
  },
  'macos-intel': {
    label: 'Intel',
    requirement:
      'Requires macOS 14 (Sonoma) or later on a Mac with an Intel processor.',
  },
  linux: { label: 'Linux', requirement: 'x86_64 AppImage' },
};

export const MAC_CHIP_HINT =
  'Not sure? Apple menu → About This Mac shows your chip.';

/**
 * Whether the edge links to the Intel Mac installer. Releases publish it only
 * when they built it, so its redirect is added once one has; until then an
 * Intel link would lead nowhere.
 */
export function intelMacPublished(
  redirects: Record<string, string> = downloadRedirects
): boolean {
  return DESKTOP_DOWNLOAD_URLS['macos-intel'] in redirects;
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
  try {
    const { architecture } = await data.getHighEntropyValues(['architecture']);
    return architecture === 'arm' || architecture === 'x86'
      ? architecture
      : undefined;
  } catch {
    return undefined;
  }
}

/** Every installer Macro publishes, Intel Mac's once its link exists. */
export function publishedInstallers(intel: boolean): DesktopInstaller[] {
  return intel ? ['macos', 'macos-intel', 'linux'] : [...DESKTOP_PLATFORMS];
}

/**
 * The installer for the visitor's own computer. A Mac gets the one for the
 * chip its browser reports, and Apple silicon when it reports none.
 */
export function visitorInstaller(
  platform: DesktopPlatform,
  architecture: MacArchitecture | undefined,
  intel: boolean
): DesktopInstaller {
  if (platform === 'macos' && intel && architecture === 'x86')
    return 'macos-intel';
  return platform;
}

/**
 * What a button or link calls an installer. Beside Intel the Mac installer
 * names its chip, and off a Mac both also say they are for a Mac.
 */
export function installerLabel(
  installer: DesktopInstaller,
  intel: boolean,
  onMac: boolean
): string {
  if (installer === 'linux' || !intel)
    return DESKTOP_PLATFORM_DETAILS[installer].label;
  const chip = installer === 'macos' ? 'Apple silicon' : 'Intel';
  return onMac ? chip : `Mac (${chip})`;
}

export type VisitorPlatform = DesktopPlatform | 'windows';

/**
 * iPadOS Safari asks for desktop sites with a Mac user agent; only its touch
 * screen tells it apart from a Mac.
 */
function isIpad(userAgent: string, maxTouchPoints: number): boolean {
  return /macintosh/i.test(userAgent) && maxTouchPoints > 1;
}

/** The visitor's desktop operating system; phones, tablets and others are undefined. */
export function detectVisitorPlatform(
  userAgent: string,
  maxTouchPoints = 0
): VisitorPlatform | undefined {
  if (/android|iphone|ipad|ipod|\bCrOS\b/i.test(userAgent)) return undefined;
  if (isIpad(userAgent, maxTouchPoints)) return undefined;
  if (/macintosh|mac os x/i.test(userAgent)) return 'macos';
  if (/windows/i.test(userAgent)) return 'windows';
  if (/linux/i.test(userAgent)) return 'linux';
  return undefined;
}

/** The visitor's platform when Macro publishes an installer for it. */
export function installerPlatform(
  visitor: VisitorPlatform | undefined
): DesktopPlatform | undefined {
  return DESKTOP_PLATFORMS.find((platform) => platform === visitor);
}

/** Phone platforms with store apps, in default display order. */
export const PHONE_PLATFORMS = ['ios', 'android'] as const;

export type PhonePlatform = (typeof PHONE_PLATFORMS)[number];

export const PHONE_PLATFORM_DETAILS: Record<
  PhonePlatform,
  { label: string; device: string; store: string; prompt: string; url: string }
> = {
  ios: {
    label: 'iOS',
    device: 'iPhone',
    store: 'App Store',
    prompt: 'Download Macro on the App Store',
    url: IOS_APP_STORE_URL,
  },
  android: {
    label: 'Android',
    device: 'Android',
    store: 'Google Play',
    prompt: 'Get Macro on Google Play',
    url: ANDROID_PLAY_STORE_URL,
  },
};

/** The visitor's phone operating system, if the browser is on one. */
export function detectPhonePlatform(
  userAgent: string,
  maxTouchPoints = 0
): PhonePlatform | undefined {
  if (/android/i.test(userAgent)) return 'android';
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'ios';
  if (isIpad(userAgent, maxTouchPoints)) return 'ios';
  return undefined;
}

/** Mobile apps with the visitor's own phone platform first, iOS by default. */
export function phonePlatformOrder(
  phone: PhonePlatform | undefined
): PhonePlatform[] {
  return phone === 'android' ? ['android', 'ios'] : ['ios', 'android'];
}
