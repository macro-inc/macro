import { invoke } from '@tauri-apps/api/core';

let lookup: Promise<unknown> | undefined;

/**
 * The installed binary's build number as `get_bundle_debug_info` reports it:
 * the Android versionCode, the iOS CFBundleVersion, or the desktop release
 * build, and 0 when the binary could not read it. Every native build has the
 * command. The build cannot change while the process runs, so one IPC call
 * serves the whole document; callers bound the wait themselves, because a
 * slow answer means different things to them.
 */
export function installedNativeBuild(): Promise<unknown> {
  lookup ??= readNativeBuild();
  return lookup;
}

async function readNativeBuild(): Promise<unknown> {
  const info = await invoke<{ nativeBuild?: unknown } | null>(
    'get_bundle_debug_info'
  );
  return info?.nativeBuild;
}
