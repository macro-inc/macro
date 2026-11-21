import { invoke } from '@tauri-apps/api/core';

let lookup: Promise<unknown> | undefined;

/**
 * The installed binary's build number as `get_bundle_debug_info` reports it:
 * the Android versionCode, the iOS CFBundleVersion, or the desktop release
 * build, and 0 when the binary could not read it. The build cannot change
 * while the process runs, so telemetry and the mail cache share one IPC call;
 * a failed call is forgotten so the next reader asks again. Readers bound the
 * wait themselves, because a slow answer means different things to them.
 */
export function installedNativeBuild(): Promise<unknown> {
  lookup ??= readNativeBuild();
  return lookup;
}

async function readNativeBuild(): Promise<unknown> {
  try {
    // A null answer throws here, as a failed lookup.
    return (await invoke<{ nativeBuild?: unknown }>('get_bundle_debug_info'))
      .nativeBuild;
  } catch (error) {
    lookup = undefined;
    throw error;
  }
}
