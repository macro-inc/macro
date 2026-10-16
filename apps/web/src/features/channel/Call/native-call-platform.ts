import { ENABLE_CALLKIT } from '@core/constant/featureFlags';
import { isPlatform, isTauri } from '@core/util/platform';
import { version } from '@tauri-apps/plugin-os';

declare global {
  interface Window {
    /** Advertised by binaries that register the Android call-kit plugin. */
    __MACRO_ANDROID_CALL_KIT__?: boolean;
  }
}

export function isNativeCallEnabled(): boolean {
  if (!ENABLE_CALLKIT || !isTauri()) return false;
  if (isPlatform('ios')) return true;
  // OTA frontend bundles also run in older APKs and on Android 7. Keep those
  // clients on browser media rather than invoking unavailable Telecom commands.
  return (
    isPlatform('android') &&
    window.__MACRO_ANDROID_CALL_KIT__ === true &&
    Number.parseInt(version(), 10) >= 8
  );
}
