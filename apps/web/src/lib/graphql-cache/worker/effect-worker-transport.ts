import * as BrowserWorker from '@effect/platform-browser/BrowserWorker';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import * as WorkerApi from 'effect/unstable/workers/Worker';
import type { WorkerError } from 'effect/unstable/workers/WorkerError';

export type BrowserWorkerEndpoint = Worker | SharedWorker | MessagePort;

export interface EffectWorkerTransportOptions<Inbound> {
  /** Existing browser endpoint. Its lifetime remains owned by the caller. */
  endpoint: BrowserWorkerEndpoint;
  onMessage(message: Inbound): void;
  onError(error: Error): void;
  /** Runs after the Effect worker scope has closed. */
  closeEndpoint?: () => void;
}

export interface EffectWorkerTransport<Outbound> {
  /** Resolves after the runner has installed its receive loop. */
  readonly ready: Promise<void>;
  /** Sends through Effect's worker protocol, including optional transferables. */
  send(message: Outbound, transfers?: readonly Transferable[]): Promise<void>;
  /** Closes the Effect scope and then the caller-owned browser endpoint. */
  close(): Promise<void>;
}

const asError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause));

/**
 * Starts Effect's parent-side browser worker protocol over an existing worker
 * endpoint while keeping endpoint construction and termination with the cache
 * ownership topology.
 */
export function createEffectWorkerTransport<Inbound, Outbound>(
  options: EffectWorkerTransportOptions<Inbound>
): EffectWorkerTransport<Outbound> {
  const backing = Effect.runSync(
    Effect.gen(function* () {
      const platform = yield* WorkerApi.WorkerPlatform;
      return yield* platform.spawn<Inbound, Outbound>(0);
    }).pipe(Effect.provide(BrowserWorker.layer(() => options.endpoint)))
  );

  let readySettled = false;
  let closed = false;
  let closePromise: Promise<void> | undefined;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const reportFailure = (error: Error): void => {
    if (!readySettled) {
      readySettled = true;
      rejectReady(error);
    }
    options.onError(error);
  };

  const run = backing
    .run(
      (message) =>
        Effect.sync(() => {
          options.onMessage(message);
        }),
      {
        onSpawn: Effect.sync(() => {
          if (readySettled) return;
          readySettled = true;
          // `Worker.run` opens its internal ready latch after `onSpawn`
          // completes, then flushes buffered sends. Resolve in the next task
          // so callers observe the fully-ready transport.
          setTimeout(resolveReady, 0);
        }),
      }
    )
    .pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          if (!closed) reportFailure(asError(Cause.squash(cause)));
        })
      )
    );
  const fiber = Effect.runFork(run);

  const messageTarget =
    'port' in options.endpoint ? options.endpoint.port : options.endpoint;
  const onMessageError: EventListener = (event): void => {
    reportFailure(
      new Error('Effect worker transport messageerror', {
        cause: (event as MessageEvent).data,
      })
    );
  };
  messageTarget.addEventListener('messageerror', onMessageError);

  return {
    ready,

    async send(
      message: Outbound,
      transfers?: readonly Transferable[]
    ): Promise<void> {
      if (closed) throw new Error('Effect worker transport is closed');
      await Effect.runPromise(backing.send(message, transfers));
    },

    close(): Promise<void> {
      if (closePromise) return closePromise;
      closed = true;
      messageTarget.removeEventListener('messageerror', onMessageError);
      closePromise = Effect.runPromise(Fiber.interrupt(fiber)).then(
        () => {
          options.closeEndpoint?.();
        },
        (error: unknown) => {
          options.closeEndpoint?.();
          throw asError(error);
        }
      );
      return closePromise;
    },
  };
}

/** Extracts Effect's typed worker failure for telemetry without exposing Effect. */
export function effectWorkerErrorTag(error: unknown):
  | WorkerError['reason']['_tag']
  | undefined {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('reason' in error) ||
    typeof error.reason !== 'object' ||
    error.reason === null ||
    !('_tag' in error.reason)
  ) {
    return undefined;
  }
  const tag = error.reason._tag;
  return tag === 'WorkerSpawnError' ||
    tag === 'WorkerSendError' ||
    tag === 'WorkerReceiveError' ||
    tag === 'WorkerUnknownError'
    ? tag
    : undefined;
}
