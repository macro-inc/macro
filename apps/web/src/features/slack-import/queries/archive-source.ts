import {
  createSlackImportWorker,
  disposeSlackImportWorker,
} from '../../../lib/workers/slack-import/worker-client';
import type { ArchiveSource } from '../context/contracts';
import { ArchiveError } from '../core/export';
import type {
  ArchiveWorkerRequest,
  ArchiveWorkerResponse,
} from '../core/worker-protocol';

/** Lazy, single-file adapter. No worker, listener or scratch DB exists before discover. */
export function createArchiveSource(
  sessionId: string = crypto.randomUUID(),
  createWorker: () => Worker = createSlackImportWorker,
  disposeWorker: typeof disposeSlackImportWorker = disposeSlackImportWorker
): ArchiveSource {
  let worker: Worker | undefined;
  let disposed = false;
  let discovered = false;
  let preparing = false;
  let rejectPending: ((error: Error) => void) | undefined;
  let handle: ((response: ArchiveWorkerResponse) => Promise<void>) | undefined;
  const queue: ArchiveWorkerResponse[] = [];
  let draining = false;
  let disposal: Promise<void> | undefined;

  function post(request: ArchiveWorkerRequest): void {
    if (disposed || !worker) throw new ArchiveError('cancelled');
    worker.postMessage(request);
  }

  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      while (!disposed && queue.length) {
        const response = queue.shift()!;
        if (response.type === 'error') throw new ArchiveError(response.code);
        if (response.type === 'cancelled') throw new ArchiveError('cancelled');
        await handle?.(response);
      }
    } catch (error) {
      rejectPending?.(
        error instanceof Error ? error : new ArchiveError('invalid_state')
      );
      handle = undefined;
      queue.length = 0;
    } finally {
      draining = false;
    }
  }

  return {
    discover(file, limits) {
      if (disposed || worker)
        return Promise.reject(new ArchiveError('invalid_state'));
      worker = createWorker();
      worker.onmessage = (event: MessageEvent<ArchiveWorkerResponse>) => {
        if (disposed || event.data.sessionId !== sessionId) return;
        queue.push(event.data);
        void drain();
      };
      worker.onerror = () => rejectPending?.(new ArchiveError('invalid_zip'));
      return new Promise((resolve, reject) => {
        rejectPending = reject;
        handle = async (response) => {
          if (response.type !== 'discovered' || discovered) return;
          discovered = true;
          handle = undefined;
          rejectPending = undefined;
          resolve(response.discovery);
        };
        post({ type: 'discover', sessionId, archive: file, limits });
      });
    },
    prepare(options) {
      if (disposed || !discovered || preparing)
        return Promise.reject(new ArchiveError('invalid_state'));
      preparing = true;
      let nextSequence = 0;
      const seals = new Map<string, string>();
      return new Promise((resolve, reject) => {
        rejectPending = reject;
        handle = async (response) => {
          if (response.type === 'part') {
            // A duplicate callback must never upload twice or acknowledge a newer part.
            if (response.sequence < nextSequence) return;
            if (response.sequence !== nextSequence)
              throw new ArchiveError('invalid_state');
            await options.part(response.descriptor, new Blob([response.bytes]));
            post({ type: 'ack_part', sessionId, sequence: nextSequence });
            nextSequence++;
          } else if (response.type === 'seal') {
            const id = response.seal.slackChannelId;
            const signature = `${id}:${response.seal.partCount}:${response.seal.manifestSha256}`;
            const previous = seals.get(id);
            if (previous !== undefined && previous !== signature)
              throw new ArchiveError('invalid_state');
            if (previous !== undefined) return;
            await options.seal(response.seal);
            seals.set(id, signature);
          } else if (response.type === 'complete') {
            handle = undefined;
            rejectPending = undefined;
            resolve();
          }
        };
        post({
          type: 'read_history',
          sessionId,
          selectedIds: options.selectedIds,
          includeMessageHistory: options.includeMessageHistory,
          partLimits: options.partLimits,
        });
      });
    },
    dispose() {
      if (disposal) return disposal;
      disposed = true;
      rejectPending?.(new ArchiveError('cancelled'));
      rejectPending = undefined;
      handle = undefined;
      queue.length = 0;
      if (worker) {
        worker.onmessage = null;
        worker.onerror = null;
        disposal = disposeWorker(worker, sessionId);
      } else {
        disposal = Promise.resolve();
      }
      return disposal;
    },
  };
}

/** Inject the app's reload hold at composition; importing this adapter has no global effects. */
export function protectImportFile(
  holdAutomaticReload: () => () => void,
  target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window
): () => void {
  const release = holdAutomaticReload();
  function beforeUnload(event: BeforeUnloadEvent): void {
    event.preventDefault();
    event.returnValue = '';
  }
  target.addEventListener('beforeunload', beforeUnload);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    target.removeEventListener('beforeunload', beforeUnload);
    release();
  };
}
