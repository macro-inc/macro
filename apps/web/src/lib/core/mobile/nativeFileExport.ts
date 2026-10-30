import { fireAndForget } from '@core/util/fireAndForget';
import { type Span, Telemetry } from '@macro-inc/observability';
import { invoke } from '@tauri-apps/api/core';

const EXPORT_CHUNK_BYTES = 256 * 1024;

export type NativeFileAction = 'save' | 'share' | 'copy';

/**
 * Exports already-fetched bytes, including authenticated downloads and Blob
 * URLs. The native side owns the size limit and rejects at `beginExport`.
 */
export async function exportNativeFile(
  plugin: 'android-mobile' | 'file-export',
  blob: Blob,
  name: string,
  action: NativeFileAction = 'save',
  {
    signal,
    onProgress,
  }: { signal?: AbortSignal; onProgress?: (fraction: number) => void } = {}
): Promise<{ canceled: boolean }> {
  return Telemetry.span('file.native.export', async (span) => {
    span.setAttr('file.size', blob.size);
    span.setAttr('file.action', action);
    span.setAttr('file.native.plugin', plugin);
    const transfer = span.span('file.native.transfer');
    let chooser: Span | undefined;
    try {
      signal?.throwIfAborted();
      const { token } = await invoke<{ token: string }>(
        `plugin:${plugin}|beginExport`,
        {
          name,
          mimeType: blob.type || 'application/octet-stream',
          size: blob.size,
        }
      );
      const discard = () =>
        fireAndForget(
          invoke(`plugin:${plugin}|discardExport`, { token }),
          'file-export-cancel'
        );
      if (plugin === 'file-export')
        signal?.addEventListener('abort', discard, { once: true });
      try {
        signal?.throwIfAborted();
        for (let offset = 0; offset < blob.size; offset += EXPORT_CHUNK_BYTES) {
          signal?.throwIfAborted();
          const bytes = new Uint8Array(
            await blob.slice(offset, offset + EXPORT_CHUNK_BYTES).arrayBuffer()
          );
          let binary = '';
          for (const byte of bytes) binary += String.fromCharCode(byte);
          await invoke(`plugin:${plugin}|appendExport`, {
            token,
            data: btoa(binary),
          });
          onProgress?.(Math.min(offset + bytes.length, blob.size) / blob.size);
        }
        signal?.throwIfAborted();
        transfer.end();
        chooser = span.span('file.native.chooser');
        const result = await invoke<{ canceled: boolean }>(
          `plugin:${plugin}|finishExport`,
          {
            token,
            action,
          }
        );
        chooser.setAttr(
          'file.outcome',
          result.canceled ? 'canceled' : 'handed_off'
        );
        return result;
      } finally {
        signal?.removeEventListener('abort', discard);
        // Cleanup failures must not mask the export result or its error.
        await invoke(`plugin:${plugin}|discardExport`, { token }).catch(
          (error) => console.error('Unable to discard native export', error)
        );
      }
    } catch (error) {
      if (signal?.aborted) span.setAttr('file.outcome', 'canceled');
      else {
        (chooser ?? transfer).error(error);
        span.error(error);
      }
      throw error;
    } finally {
      transfer.end();
      chooser?.end();
    }
  });
}
