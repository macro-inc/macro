export type MacroPlatform = 'web' | 'desktop' | 'ios' | 'android';
export type NativeMobilePlatform = Extract<MacroPlatform, 'ios' | 'android'>;

const VALID_PLATFORMS: ReadonlyArray<MacroPlatform> = [
  'web',
  'desktop',
  'ios',
  'android',
];

function resolveBuildPlatform(): MacroPlatform {
  const platform = import.meta.env.VITE_PLATFORM;
  if (platform && VALID_PLATFORMS.includes(platform)) return platform;
  return 'web';
}

const buildPlatform = resolveBuildPlatform();

export function getPlatform(): MacroPlatform {
  return buildPlatform;
}

export function isPlatform(target: MacroPlatform | MacroPlatform[]): boolean {
  const platform = getPlatform();
  return Array.isArray(target)
    ? target.includes(platform)
    : platform === target;
}

export function isMobilePlatform(): boolean;
export function isMobilePlatform(
  platform: MacroPlatform
): platform is NativeMobilePlatform;
export function isMobilePlatform(
  platform: MacroPlatform = getPlatform()
): boolean {
  return platform === 'ios' || platform === 'android';
}

export function isDesktopPlatform(): boolean {
  return isPlatform('desktop');
}

export function getNativeMobilePlatform() {
  const platform = getPlatform();
  return isMobilePlatform(platform) ? platform : undefined;
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
