import {
  createStaticUploadFile,
  createUploadFile,
} from '@core/util/uploadFile';
import { Telemetry } from '@macro-inc/observability';
import { ResultAsync } from 'neverthrow';
import type { Gif } from './klipy';

type GifUploadError = { kind: 'cancelled' } | { kind: 'failed' };
/** Keep the original animated bytes; never decode through an image or canvas. */
export function uploadGif(
  gif: Gif,
  signal: AbortSignal
): ResultAsync<string, GifUploadError> {
  return ResultAsync.fromPromise(
    Telemetry.span('gif.upload', async (span) => {
      span.setAttr('gif.id', gif.id);
      try {
        const file = await span.span('gif.download', async () => {
          const response = await fetch(gif.url, {
            signal,
            credentials: 'omit',
          });
          if (!response.ok)
            throw new Error(`GIF download failed: ${response.status}`);
          const blob = await response.blob();
          const signature = await blob.slice(0, 6).text();
          if (signature !== 'GIF87a' && signature !== 'GIF89a') {
            throw new Error('The download is not a GIF');
          }
          span.setAttr('file.size', blob.size);
          return new File([blob], 'animation.gif', { type: 'image/gif' });
        });
        signal.throwIfAborted();
        const id = await span.span('gif.static_upload', () =>
          createStaticUploadFile(createUploadFile(file), signal)
        );
        span.setAttr('file.id', id);
        return id;
      } catch (error) {
        if (signal.aborted) span.setAttr('gif.cancelled', true);
        else span.error(error);
        throw error;
      }
    }),
    () => ({ kind: signal.aborted ? 'cancelled' : 'failed' })
  );
}
