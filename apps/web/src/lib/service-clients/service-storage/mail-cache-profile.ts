import { getNativeMobilePlatform } from '@core/util/platform';
import { invoke, isTauri } from '@tauri-apps/api/core';

const CURRENT_PROFILE = 'soup-mail-v5';
const LEGACY_PROFILE = 'soup-mail-v2';
let nativeProfile: Promise<string> | undefined;

/** Negotiate against the installed engine, including when JS arrived by OTA. */
export function mailCacheProfile(): Promise<string> {
  if (!isTauri()) return Promise.resolve(CURRENT_PROFILE);
  nativeProfile ??= installedNativeProfile();
  return nativeProfile;
}

async function installedNativeProfile(): Promise<string> {
  try {
    const { nativeBuild } = await invoke<{ nativeBuild: number }>(
      'get_bundle_debug_info'
    );
    const platform = getNativeMobilePlatform();
    const minimum =
      platform === 'ios' ? 193 : platform === 'android' ? 20 : null;
    return minimum !== null &&
      Number.isInteger(nativeBuild) &&
      nativeBuild >= minimum
      ? CURRENT_PROFILE
      : LEGACY_PROFILE;
  } catch {
    // Older engines may not expose build information. Never infer support from JS.
    return LEGACY_PROFILE;
  }
}
