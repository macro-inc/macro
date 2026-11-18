import { isTauri } from '@core/util/platform';
import { type as nativeOsType } from '@tauri-apps/plugin-os';

/** OpenTelemetry `os.type` values, plus the mobile and ChromeOS families. */
export type OsType =
  | 'darwin'
  | 'windows'
  | 'linux'
  | 'ios'
  | 'android'
  | 'chromeos'
  | 'unknown';

type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: { platform?: string };
};

/**
 * The operating system family only, for splitting performance by OS. Never
 * record versions, architectures or the user agent string.
 */
export function osType(): OsType {
  if (isTauri()) return fromPlatformName(nativeOsType());
  if (typeof navigator === 'undefined') return 'unknown';
  const browser = navigator as NavigatorWithUserAgentData;
  const fromHints = fromPlatformName(browser.userAgentData?.platform ?? '');
  if (fromHints !== 'unknown') return fromHints;
  return fromUserAgent(navigator.userAgent);
}

function fromPlatformName(platform: string): OsType {
  const name = platform.toLowerCase();
  if (name === 'macos' || name === 'mac os x' || name === 'darwin')
    return 'darwin';
  if (name === 'windows') return 'windows';
  if (name === 'linux') return 'linux';
  if (name === 'ios') return 'ios';
  if (name === 'android') return 'android';
  if (name === 'chrome os' || name === 'chromeos') return 'chromeos';
  return 'unknown';
}

function fromUserAgent(userAgent: string): OsType {
  // Order matters: Android user agents also name Linux.
  if (/iPhone|iPad|iPod/.test(userAgent)) return 'ios';
  if (/Android/.test(userAgent)) return 'android';
  if (/CrOS/.test(userAgent)) return 'chromeos';
  if (/Windows/.test(userAgent)) return 'windows';
  if (/Macintosh|Mac OS X/.test(userAgent)) return 'darwin';
  if (/Linux|X11/.test(userAgent)) return 'linux';
  return 'unknown';
}
