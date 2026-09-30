import { invoke } from '@tauri-apps/api/core';

const EXPORT_CHUNK_BYTES = 256 * 1024;

export type AndroidFileAction = 'save' | 'share' | 'open' | 'copy';

/** Exports already-fetched bytes, including authenticated downloads and Blob URLs. */
export async function exportAndroidFile(
  blob: Blob,
  name: string,
  action: AndroidFileAction = 'save',
  options?: { signal?: AbortSignal; onProgress?: (fraction: number) => void }
): Promise<{ canceled: boolean }> {
  options?.signal?.throwIfAborted();
  if (blob.size > 500 * 1024 * 1024)
    throw new Error('Files must be 500 MB or smaller');
  const { token } = await invoke<{ token: string }>(
    'plugin:android-mobile|beginExport',
    {
      name,
      mimeType: blob.type || 'application/octet-stream',
    }
  );
  try {
    for (let offset = 0; offset < blob.size; offset += EXPORT_CHUNK_BYTES) {
      options?.signal?.throwIfAborted();
      const bytes = new Uint8Array(
        await blob.slice(offset, offset + EXPORT_CHUNK_BYTES).arrayBuffer()
      );
      let binary = '';
      for (const byte of bytes) binary += String.fromCharCode(byte);
      await invoke('plugin:android-mobile|appendExport', {
        token,
        data: btoa(binary),
      });
      options?.onProgress?.(
        Math.min(offset + bytes.length, blob.size) / blob.size
      );
    }
    options?.signal?.throwIfAborted();
    options?.onProgress?.(1);
    return await invoke('plugin:android-mobile|finishExport', {
      token,
      action,
    });
  } finally {
    // Cleanup failures must not mask the export result or its error.
    await invoke('plugin:android-mobile|discardExport', { token }).catch(
      (error) => console.error('Unable to discard Android export', error)
    );
  }
}
