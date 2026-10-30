import { exportNativeFile, type NativeFileAction } from './nativeFileExport';

export type AndroidFileAction = NativeFileAction;

export function exportAndroidFile(
  blob: Blob,
  name: string,
  action: AndroidFileAction = 'save',
  options?: { signal?: AbortSignal; onProgress?: (fraction: number) => void }
): Promise<{ canceled: boolean }> {
  return exportNativeFile('android-mobile', blob, name, action, options);
}
