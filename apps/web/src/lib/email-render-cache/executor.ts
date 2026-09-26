import {
  type BodyOptions,
  type EmailBodyInput,
  type PreparedEmailBody,
  prepareEmailBody,
} from '@macro-inc/email-renderer';
import { digest, sourceBytes, sourceTuple } from './keys';

export interface PreparationExecutor {
  hash(tuple: string): Promise<string>;
  hashSource(input: EmailBodyInput, priority?: number): Promise<string>;
  prepare(
    input: EmailBodyInput,
    options: BodyOptions,
    priority?: number
  ): Promise<PreparedEmailBody>;
  dispose(): void;
}

export type WorkerRequest = { id: number } & (
  | { kind: 'hash'; tuple: string }
  | { kind: 'source'; input: EmailBodyInput }
  | { kind: 'prepare'; input: EmailBodyInput; options: BodyOptions }
);
export interface WorkerResponse {
  id: number;
  result?: string | PreparedEmailBody;
  error?: string;
}

export const directExecutor: PreparationExecutor = {
  hash: digest,
  hashSource: async (input) => await digest(sourceTuple(input)),
  async prepare(input, options) {
    return prepareEmailBody(input, options);
  },
  dispose() {},
};

/** Construct on first work, never at module evaluation (WKWebView). */
export function createPreparationExecutor(
  allowWorker = true
): PreparationExecutor {
  let worker: Worker | undefined;
  let workerReady = false;
  let failed = !allowWorker;
  let disposed = false;
  let sequence = 0;
  const pending = new Map<
    number,
    {
      resolve(value: string | PreparedEmailBody): void;
      reject(error: unknown): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  function stop(): void {
    worker?.terminate();
    worker = undefined;
    workerReady = false;
    for (const job of pending.values()) {
      clearTimeout(job.timer);
      job.reject(new Error('Preparation worker stopped'));
    }
    pending.clear();
  }

  async function execute(
    request: WorkerRequest,
    preferDirect = false
  ): Promise<string | PreparedEmailBody> {
    if (disposed) throw new Error('Preparation executor disposed');
    if (!failed && !preferDirect) {
      try {
        if (!worker) {
          worker = new Worker(new URL('./prepare.worker.ts', import.meta.url), {
            type: 'module',
          });
          worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
            workerReady = true;
            const job = pending.get(data.id);
            if (!job) return;
            pending.delete(data.id);
            clearTimeout(job.timer);
            if (data.error || data.result === undefined)
              job.reject(new Error('Email preparation worker failed'));
            else job.resolve(data.result);
          };
          worker.onerror = () => {
            failed = true;
            stop();
          };
          worker.onmessageerror = () => {
            failed = true;
            stop();
          };
        }
        return await new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            failed = true;
            stop();
          }, 15000);
          pending.set(request.id, {
            resolve,
            reject,
            timer,
          });
          worker!.postMessage(request);
        });
      } catch {
        failed = true;
        stop();
      }
    }
    if (disposed) throw new Error('Preparation executor disposed');
    if (request.kind === 'hash') return await digest(request.tuple);
    if (request.kind === 'source')
      return await digest(sourceTuple(request.input));
    return prepareEmailBody(request.input, request.options);
  }

  return {
    async hash(tuple) {
      return (await execute(
        { id: ++sequence, kind: 'hash', tuple },
        true
      )) as string;
    },
    async hashSource(input, priority = 0) {
      // WebCrypto is already asynchronous. Starting a parser worker just to
      // hash a body adds a cold runtime to the foreground critical path.
      return (await execute(
        { id: ++sequence, kind: 'source', input },
        priority === 0 || !workerReady
      )) as string;
    },
    async prepare(input, options, priority = 0) {
      // A bounded foreground miss uses the already-loaded parser. Speculative
      // work and larger bodies remain off the main thread. This starting bound
      // includes all source fields and needs device-specific profiling.
      return (await execute(
        { id: ++sequence, kind: 'prepare', input, options },
        priority === 0 && sourceBytes(input) <= 512 * 1024
      )) as PreparedEmailBody;
    },
    dispose() {
      disposed = true;
      stop();
    },
  };
}
