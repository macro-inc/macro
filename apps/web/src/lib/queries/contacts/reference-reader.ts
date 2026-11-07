import { anyAbortSignal } from '@core/util/abort-signal';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  assertContactReferenceInput,
  type ContactReferenceHost,
  type ContactReferenceRequest,
  type ContactReferenceResolution,
  resolveContactReferences,
} from './references';

export type ContactReferenceReader = (
  viewer: string,
  host: ContactReferenceHost | undefined,
  request: ContactReferenceRequest,
  signal: AbortSignal
) => Promise<ContactReferenceResolution>;

type Job = {
  viewer: string;
  host: ContactReferenceHost | undefined;
  request: ContactReferenceRequest;
  signal: AbortSignal;
  resolve: (value: ContactReferenceResolution) => void;
  reject: (error: unknown) => void;
  detach: () => void;
};

/** Native scans cannot be interrupted once dispatched. Keep one running read
 * and one replaceable pending input instead of queueing a history of scans. */
export function createContactReferenceReader(
  reader: ContactReferenceReader = resolveContactReferences
) {
  const lifetime = new AbortController();
  let running = false;
  let pending: Job | undefined;

  async function run(job: Job) {
    running = true;
    try {
      job.signal.throwIfAborted();
      const result = await reader(
        job.viewer,
        job.host,
        job.request,
        job.signal
      );
      job.signal.throwIfAborted();
      job.resolve(result);
    } catch (error) {
      job.reject(error);
    } finally {
      job.detach();
      running = false;
      const next = pending;
      pending = undefined;
      if (next && !lifetime.signal.aborted)
        fireAndForget(run(next), 'contact-references');
    }
  }

  const read: ContactReferenceReader = (
    viewer,
    host,
    request,
    callerSignal
  ) => {
    const signal = anyAbortSignal([callerSignal, lifetime.signal]);
    return new Promise<ContactReferenceResolution>((resolve, reject) => {
      signal.throwIfAborted();
      assertContactReferenceInput(request);
      const abort = () => {
        if (pending === job) pending = undefined;
        job.detach();
        reject(signal.reason);
      };
      const job: Job = {
        viewer,
        host,
        request,
        signal,
        resolve,
        reject,
        detach: () => signal.removeEventListener('abort', abort),
      };
      signal.addEventListener('abort', abort, { once: true });
      if (running) {
        const previous = pending;
        pending = job;
        previous?.detach();
        previous?.reject(
          new DOMException('Contact reference input superseded', 'AbortError')
        );
      } else fireAndForget(run(job), 'contact-references');
    });
  };
  return { read, dispose: () => lifetime.abort() };
}
