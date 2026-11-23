import { invoke } from '@tauri-apps/api/core';

export type BundleDebugInfo = {
  bundleBuild: number;
  source: 'embedded' | 'ota';
  nativeBuild: number;
};

export async function getBundleDebugInfo(): Promise<BundleDebugInfo | null> {
  try {
    return await invoke<BundleDebugInfo>('get_bundle_debug_info');
  } catch (error) {
    console.error('[bundle-update] get_bundle_debug_info failed', error);
    return null;
  }
}
