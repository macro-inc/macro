import { installedNativeBuild } from '@app/lib/tauri/native-build';
import { getNativeMobilePlatform } from '@core/util/platform';
import { isTauri } from '@tauri-apps/api/core';

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
const TIMED_OUT = Symbol('timed out');

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
    const nativeBuild = await Promise.race([
      installedNativeBuild(),
      new Promise<typeof TIMED_OUT>((resolve) => {
        timeout = setTimeout(() => resolve(TIMED_OUT), 1500);
      }),
    ]);
    if (nativeBuild === TIMED_OUT) {
      return { profile: LEGACY_PROFILE, outcome: 'native_lookup_timeout' };
    }
    const platform = getNativeMobilePlatform();
    const minimum =
      platform === 'ios' ? 193 : platform === 'android' ? 20 : null;
    if (
      minimum !== null &&
      typeof nativeBuild === 'number' &&
      Number.isInteger(nativeBuild) &&
      nativeBuild >= minimum
    ) {
      return { profile: CURRENT_PROFILE, outcome: 'native_supported' };
    }
    return { profile: LEGACY_PROFILE, outcome: 'native_unsupported' };
  } catch {
    // The binary did not answer with its build. Never infer support from JS.
    return { profile: LEGACY_PROFILE, outcome: 'native_lookup_failed' };
  } finally {
    clearTimeout(timeout);
  }
}
