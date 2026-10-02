import { deleteMessageStore } from './message-store';

/** Await on owner disposal; Worker.terminate() alone cannot clean IndexedDB. */
export async function disposeSlackImportWorker(
  worker: Worker,
  sessionId: string
): Promise<void> {
  worker.terminate();
  await deleteMessageStore(sessionId);
}

/** Call from the file-picker action only; importing this module starts no worker.
 * Keep construction outside the worker's import graph to avoid recursive bundling.
 */
export function createSlackImportWorker(): Worker {
  return new Worker(new URL('./unzip-worker.ts', import.meta.url), {
    type: 'module',
  });
}
