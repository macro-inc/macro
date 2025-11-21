export type MacroPlatform = 'web' | 'desktop' | 'ios' | 'android';
export type NativeMobilePlatform = Extract<MacroPlatform, 'ios' | 'android'>;

const VALID_PLATFORMS: ReadonlyArray<MacroPlatform> = [
  'web',
  'desktop',
  'ios',
  'android',
];

function resolveBuildPlatform(): MacroPlatform {
  const platform = import.meta?.env?.VITE_PLATFORM as MacroPlatform | undefined;
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

export function isMobilePlatform(): boolean {
  return isPlatform(['ios', 'android']);
}

export function isDesktopPlatform(): boolean {
  return isPlatform('desktop');
}

export function getNativeMobilePlatform():
  | NativeMobilePlatform
  | undefined {
  return isMobilePlatform()
    ? (getPlatform() as NativeMobilePlatform)
    : undefined;
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
