import { invoke } from '@tauri-apps/api/core';

/** HTTPS works even when the Play Store app is absent. */
export function nativeUpdateLink(platform: 'ios' | 'android'): string {
  return platform === 'android'
    ? 'https://play.google.com/store/apps/details?id=com.macro.app.prod'
    : 'https://apps.apple.com/us/app/macro-app/id6743133649';
}

/** Keep the current app usable when the operating system cannot open the link. */
export async function openNativeUpdateLink(
  platform: 'ios' | 'android'
): Promise<boolean> {
  try {
    await invoke('plugin:opener|open_url', { url: nativeUpdateLink(platform) });
    return true;
  } catch (error) {
    console.error('[native-update] unable to open store', error);
    return false;
  }
}
