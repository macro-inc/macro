import { invoke } from '@tauri-apps/api/core';

export type BundleDebugInfo = {
  bundleBuild: number;
  source: 'embedded' | 'ota';
  nativeBuild: number;
};

// Release bundle builds are millisecond timestamps; local smoke builds use
// small counters (e.g. 100) that are not dates.
const MIN_TIMESTAMP_MS = Date.UTC(2020, 0, 1);

function timestampDate(ms: number | undefined): Date | undefined {
  return ms && Number.isFinite(ms) && ms >= MIN_TIMESTAMP_MS
    ? new Date(ms)
    : undefined;
}

/** When the running JavaScript was built. */
export function appBuildDate(): Date | undefined {
  return timestampDate(import.meta.env.__APP_BUILD_TIME__);
}

/** When the active OTA bundle was built; undefined while the embedded bundle runs. */
export function otaBundleDate(
  info: BundleDebugInfo | null | undefined
): Date | undefined {
  return info?.source === 'ota' ? timestampDate(info.bundleBuild) : undefined;
}

export async function getBundleDebugInfo(): Promise<BundleDebugInfo | null> {
  try {
    return await invoke<BundleDebugInfo>('get_bundle_debug_info');
  } catch (error) {
    console.error('[bundle-update] get_bundle_debug_info failed', error);
    return null;
  }
}
