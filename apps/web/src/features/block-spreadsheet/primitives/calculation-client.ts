import type {
  CalculationOperation,
  CalculationRequest,
  CalculationResponse,
} from '../core/calculation-protocol';

export type CalculationWorker = Pick<
  Worker,
  'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'
>;
export const CALCULATION_TIMEOUT_MS = 3_000;
const ENGINE_LOAD_TIMEOUT_MS = 15_000;

/** A hung WASM call can only be interrupted by terminating its worker. */
export function createCalculationClient(
  makeWorker: () => CalculationWorker = () =>
    new Worker(new URL('../workers/calculation.worker.ts', import.meta.url), {
      type: 'module',
    }),
  timeoutMs = CALCULATION_TIMEOUT_MS
) {
  let worker: CalculationWorker | undefined;
  let initialized = false;
  let sequence = 0;
  let pending:
    | {
        id: number;
        timer: ReturnType<typeof setTimeout>;
        resolve: (result: CalculationResponse) => void;
        reject: (error: Error) => void;
      }
    | undefined;

  function stop(error = new Error('Calculation cancelled.')) {
    worker?.terminate();
    worker = undefined;
    initialized = false;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      pending = undefined;
    }
  }

  function run(operation: CalculationOperation): Promise<CalculationResponse> {
    if (pending) stop();
    return new Promise((resolve, reject) => {
      try {
        if (!worker) {
          worker = makeWorker();
          worker.onmessage = (event: MessageEvent<CalculationResponse>) => {
            if (event.data.id !== pending?.id) return;
            const current = pending;
            clearTimeout(current.timer);
            if (event.data.type === 'started') {
              initialized = true;
              current.timer = setTimeout(
                () =>
                  stop(
                    new Error(
                      'Calculation exceeded 3 seconds. Simplify or undo the last formula, then retry.'
                    )
                  ),
                timeoutMs
              );
              return;
            }
            if (event.data.type === 'error') {
              stop(new Error(event.data.message));
              return;
            }
            pending = undefined;
            current.resolve(event.data);
          };
          worker.onerror = () =>
            stop(
              new Error(
                'The calculation engine stopped. Edit a formula or retry.'
              )
            );
          worker.onmessageerror = () =>
            stop(new Error('The calculation result could not be read.'));
        }
        const id = ++sequence;
        pending = {
          id,
          resolve,
          reject,
          timer: setTimeout(
            () =>
              stop(
                new Error(
                  initialized
                    ? 'Calculation exceeded 3 seconds. Simplify or undo the last formula, then retry.'
                    : 'The calculation engine took too long to load. Check your connection and retry.'
                )
              ),
            initialized ? timeoutMs : ENGINE_LOAD_TIMEOUT_MS
          ),
        };
        const request: CalculationRequest = { ...operation, id };
        worker.postMessage(request);
      } catch (error) {
        const cause =
          error instanceof Error
            ? error
            : new Error('Unable to start calculation.');
        stop(cause);
        reject(cause);
      }
    });
  }
  return { run, dispose: stop };
}
