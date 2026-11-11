import { anyAbortSignal } from './abort-signal';
import { fireAndForget } from './fireAndForget';

type Job<Input, Output> = {
  input: Input;
  signal: AbortSignal;
  resolve: (value: Output) => void;
  reject: (error: unknown) => void;
  detach: () => void;
};

/** Uninterruptible cache work gets one physical read and one replaceable input,
 * never a queue of obsolete scans. Cancellation still settles callers promptly. */
export function createReplaceableReader<Input, Output>(
  reader: (input: Input, signal: AbortSignal) => Promise<Output>
) {
  const lifetime = new AbortController();
  let running = false;
  let pending: Job<Input, Output> | undefined;
  async function run(job: Job<Input, Output>) {
    running = true;
    try {
      job.signal.throwIfAborted();
      const result = await reader(job.input, job.signal);
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
        fireAndForget(run(next), 'cache-read');
    }
  }
  function read(input: Input, callerSignal: AbortSignal): Promise<Output> {
    // The browser-floor helper detaches its parent listeners on abort. Finish
    // each job's signal too, rather than retaining completed reads on lifetime.
    const completion = new AbortController();
    const signal = anyAbortSignal([
      callerSignal,
      lifetime.signal,
      completion.signal,
    ]);
    return new Promise<Output>((resolve, reject) => {
      signal.throwIfAborted();
      const abort = () => {
        if (pending === job) pending = undefined;
        job.detach();
        reject(signal.reason);
      };
      const job: Job<Input, Output> = {
        input,
        signal,
        resolve,
        reject,
        detach: () => {
          signal.removeEventListener('abort', abort);
          completion.abort();
        },
      };
      signal.addEventListener('abort', abort, { once: true });
      if (running) {
        const previous = pending;
        pending = job;
        previous?.detach();
        previous?.reject(
          new DOMException('Cache read input superseded', 'AbortError')
        );
      } else fireAndForget(run(job), 'cache-read');
    });
  }
  return { read, dispose: () => lifetime.abort() };
}
