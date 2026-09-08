/**
 * Stub for @service-storage/websocket, swapped in by the demo's Vite config.
 *
 * The real module builds a storage-service socket at module scope; the editor
 * reaches it through @core/util/upload. Uploads need a bucket the demo has no
 * credentials for, so there is nothing to keep alive here.
 */
import { createInertSocket } from './inertSocket';

export const storageWS = createInertSocket();

/**
 * Rejects rather than hanging.
 *
 * This only backs PDF preprocess/export, which a markdown demo has no route
 * to. If something does reach it, a rejection names the reason in the console
 * and settles the promise; a promise that never settled would strand whatever
 * awaited it with no explanation.
 */
export function createWebSocketJob<T, R, D, U>(config: {
  data: D;
  action: string;
  processResult: (data: U, jobId: string) => Promise<T | undefined>;
  handleSuccess: (result: T) => Promise<R>;
}): Promise<R> {
  return Promise.reject(
    new Error(
      `[marketing demo] websocket job "${config.action}" is unavailable: the demo has no storage service.`
    )
  );
}
