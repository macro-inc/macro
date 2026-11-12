import { match } from 'ts-pattern';
import type { HashWorkerResponse } from '../../workers/file-hash/hash-worker';
import HashWorker from '../../workers/file-hash/hash-worker?worker';
import { contentHash } from './hash';

/**
 * Files up to this size are read whole and hashed in one native call, which is
 * fast and starts no worker; larger ones are streamed through a worker so the
 * file is never held in memory.
 */
const WHOLE_FILE_HASH_MAX_BYTES = 32 * 1024 * 1024;

/** Streams `file` through a hash worker, created on first use and ended after. */
function hashInWorker(
  file: File,
  onProgress: ((fraction: number) => void) | undefined
): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new HashWorker();
    const finish = (settle: () => void) => {
      worker.terminate();
      settle();
    };
    worker.onmessage = (event: MessageEvent<HashWorkerResponse>) => {
      match(event.data)
        .with({ type: 'progress' }, ({ processedBytes }) =>
          onProgress?.(processedBytes / file.size)
        )
        .with({ type: 'complete' }, ({ sha256 }) =>
          finish(() => resolve(sha256))
        )
        .with({ type: 'error' }, ({ message }) =>
          finish(() => reject(new Error(message)))
        )
        .exhaustive((unknown) =>
          finish(() =>
            reject(
              new Error(`Unexpected hash worker reply: ${String(unknown)}`)
            )
          )
        );
    };
    worker.onerror = (error: ErrorEvent) => {
      worker.terminate();
      reject(new Error(error.message || 'The file could not be read'));
    };
    worker.postMessage({ file });
  });
}

/**
 * Hex SHA-256 of a file, without holding a large file in memory. A streamed
 * file reports the share hashed so far to `onProgress`.
 */
export async function hashFile(
  file: File,
  onProgress?: (fraction: number) => void
): Promise<string> {
  if (file.size <= WHOLE_FILE_HASH_MAX_BYTES) {
    return contentHash(await file.arrayBuffer());
  }
  return hashInWorker(file, onProgress);
}
