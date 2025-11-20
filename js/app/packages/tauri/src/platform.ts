export type MacroPlatform = 'web' | 'tauri-all' | 'tauri-ios' | 'tauri-android';

const DEFAULT_PLATFORM: MacroPlatform = 'web';

const platform = (() => {
  const envPlatform = import.meta.env.VITE_PLATFORM;
  if (
    envPlatform === 'web' ||
    envPlatform === 'tauri-all' ||
    envPlatform === 'tauri-ios' ||
    envPlatform === 'tauri-android'
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
  return platform === 'tauri-ios' || platform === 'tauri-android';
}

export function isTauriDesktopPlatform(): boolean {
  return platform === 'tauri-all';
}
