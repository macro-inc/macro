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

/**
 * When the installed native binary was built. OTA bundle updates replace the
 * JavaScript but not the binary, so this date stays fixed until the app itself
 * is updated. Binaries older than the command (reached only through OTA) have
 * no build date to report.
 */
export async function getNativeBuildDate(): Promise<Date | undefined> {
  try {
    return timestampDate(await invoke<number>('get_native_build_time'));
  } catch {
    return undefined;
  }
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
