import { getNativeMobilePlatform } from '@core/util/platform';
import { invoke, isTauri } from '@tauri-apps/api/core';

const CURRENT_PROFILE = 'soup-mail-v5';
const LEGACY_PROFILE = 'soup-mail-v2';

type MailCacheProfile = {
  profile: typeof CURRENT_PROFILE | typeof LEGACY_PROFILE;
  outcome:
    | 'browser'
    | 'native_supported'
    | 'native_unsupported'
    | 'native_lookup_failed'
    | 'native_lookup_timeout';
};

let nativeProfile: Promise<MailCacheProfile> | undefined;

/** Negotiate against the installed engine, including when JS arrived by OTA. */
export function mailCacheProfile(): Promise<MailCacheProfile> {
  if (!isTauri()) {
    return Promise.resolve({ profile: CURRENT_PROFILE, outcome: 'browser' });
  }
  nativeProfile ??= installedNativeProfile();
  return nativeProfile;
}

async function installedNativeProfile(): Promise<MailCacheProfile> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const info = await Promise.race([
      invoke<{ nativeBuild: number }>('get_bundle_debug_info'),
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => resolve(null), 1500);
      }),
    ]);
    if (info === null) {
      return { profile: LEGACY_PROFILE, outcome: 'native_lookup_timeout' };
    }
    const platform = getNativeMobilePlatform();
    const minimum =
      platform === 'ios' ? 193 : platform === 'android' ? 20 : null;
    if (
      minimum !== null &&
      Number.isInteger(info.nativeBuild) &&
      info.nativeBuild >= minimum
    ) {
      return { profile: CURRENT_PROFILE, outcome: 'native_supported' };
    }
    return { profile: LEGACY_PROFILE, outcome: 'native_unsupported' };
  } catch {
    // Older engines may not expose build information. Never infer support from JS.
    return { profile: LEGACY_PROFILE, outcome: 'native_lookup_failed' };
  } finally {
    clearTimeout(timeout);
  }
}
