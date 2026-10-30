import { invoke } from '@tauri-apps/api/core';
import { exportNativeFile } from './nativeFileExport';

/** Older installed binaries keep Web Share until the native bridge ships. */
export async function hasIosFileExport(): Promise<boolean> {
  try {
    return await invoke<boolean>('plugin:file-export|available');
  } catch {
    return false;
  }
}

export function exportIosFile(
  file: File,
  action: 'save' | 'share',
  options: { signal: AbortSignal; onProgress: (fraction: number) => void }
) {
  return exportNativeFile('file-export', file, file.name, action, options);
}
