import { type as osType } from '@tauri-apps/plugin-os';

type MacroPlatform = 'web' | 'desktop' | 'ios' | 'android';
type NativeMobilePlatform = Extract<MacroPlatform, 'ios' | 'android'>;

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

function isMobilePlatform(): boolean;
function isMobilePlatform(
  platform: MacroPlatform
): platform is NativeMobilePlatform;
function isMobilePlatform(platform: MacroPlatform = getPlatform()): boolean {
  return platform === 'ios' || platform === 'android';
}

function _isDesktopPlatform(): boolean {
  return isPlatform('desktop');
}

export function getNativeMobilePlatform() {
  const platform = getPlatform();
  return isMobilePlatform(platform) ? platform : undefined;
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
