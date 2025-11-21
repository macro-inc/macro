export type MacroPlatform = 'web' | 'desktop' | 'ios' | 'android';

const DEFAULT_PLATFORM: MacroPlatform = 'web';

const platform = (() => {
  const envPlatform = import.meta.env.VITE_PLATFORM;
  if (
    envPlatform === 'web' ||
    envPlatform === 'desktop' ||
    envPlatform === 'ios' ||
    envPlatform === 'android'
  ) {
    return envPlatform;
  }
  return DEFAULT_PLATFORM;
})();

export function getPlatform(): MacroPlatform {
  return platform;
}

export function isPlatform(target: MacroPlatform | MacroPlatform[]): boolean {
  return Array.isArray(target)
    ? target.includes(platform)
    : platform === target;
}

export function isTauriPlatform(): boolean {
  return platform !== 'web';
}

export function isTauriMobilePlatform(): boolean {
  return platform === 'ios' || platform === 'android';
}

export function isTauriDesktopPlatform(): boolean {
  return platform === 'desktop';
}
