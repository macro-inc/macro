import { type as osType } from '@tauri-apps/plugin-os';

export type MacroPlatform = 'web' | 'desktop' | 'ios' | 'android';
export type NativeMobilePlatform = Extract<MacroPlatform, 'ios' | 'android'>;

let cached: MacroPlatform | undefined;

function detectPlatform(): MacroPlatform {
  if (!isTauri()) return 'web';
  const os = osType();
  if (os === 'ios') return 'ios';
  if (os === 'android') return 'android';
  return 'desktop';
}

export function getPlatform(): MacroPlatform {
  if (cached === undefined) cached = detectPlatform();
  return cached;
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
