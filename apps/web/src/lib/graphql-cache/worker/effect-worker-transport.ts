import * as BrowserWorker from '@effect/platform-browser/BrowserWorker';
import * as BrowserWorkerRunner from '@effect/platform-browser/BrowserWorkerRunner';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import * as Queue from 'effect/Queue';
import * as WorkerApi from 'effect/unstable/workers/Worker';
import type { WorkerError } from 'effect/unstable/workers/WorkerError';

export type BrowserWorkerEndpoint = Worker | SharedWorker | MessagePort;

/** Effect's parent-to-runner request frame tag. */
export const EFFECT_WORKER_REQUEST_TAG = 0 as const;
/** Effect's runner-to-parent ready frame. */
export const EFFECT_WORKER_READY_FRAME = [EFFECT_WORKER_REQUEST_TAG] as const;
/** Effect's runner-to-parent response frame tag. */
export const EFFECT_WORKER_RESPONSE_TAG = 1 as const;
/** Effect's parent-to-runner close frame. */
export const EFFECT_WORKER_CLOSE_FRAME = [EFFECT_WORKER_RESPONSE_TAG] as const;

export interface EffectWorkerTransportOptions<Inbound> {
  /** Existing browser endpoint. Its lifetime remains owned by the caller. */
  endpoint: BrowserWorkerEndpoint;
  onMessage(message: Inbound): void;
  onError(error: Error): void;
  /** Synchronously closes the caller-owned browser endpoint. */
  closeEndpoint?: () => void;
}

export interface EffectWorkerTransport<Outbound> {
  /** Resolves after the runner has installed its receive loop. */
  readonly ready: Promise<void>;
  /** Sends through Effect's worker protocol, including optional transferables. */
  send(
    message: Outbound,
    transfers?: readonly Transferable[]
  ): Effect.Effect<void, Error>;
  /** Closes the Effect scope and then the caller-owned browser endpoint. */
  close(): Effect.Effect<void>;
}

const asError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause));

const originalWorkerError = (error: WorkerError): Error =>
  error.reason.cause instanceof Error ? error.reason.cause : error;

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
          // Effect invokes `onSpawn` before opening its private ready latch.
          // Resolving synchronously here lets awaiters run before buffered sends
          // flush (covered by the transport ordering test), so defer one task.
          setTimeout(() => {
            if (readySettled) return;
            readySettled = true;
            resolveReady();
          }, 0);
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
  const fiber = Effect.runFork(run);

  return {
    ready,

    send(message, transfers): Effect.Effect<void, Error> {
      return Effect.suspend(() => {
        if (closed) {
          return Effect.fail(new Error('Effect worker transport is closed'));
        }
        return backing
          .send(message, transfers)
          .pipe(Effect.mapError(originalWorkerError));
      });
    },

    close(): Effect.Effect<void> {
      return Effect.suspend(() => {
        if (!closed) {
          closed = true;
          if (!readySettled) {
            readySettled = true;
            rejectReady(
              new Error('Effect worker transport closed before ready')
            );
          }
          messageTarget.removeEventListener('messageerror', onMessageError);
          // Preserve the browser adapter's synchronous endpoint teardown while
          // still speaking Effect's explicit close protocol to the runner.
          try {
            messageTarget.postMessage(EFFECT_WORKER_CLOSE_FRAME);
          } catch {
            // Endpoint teardown remains authoritative if close framing fails.
          } finally {
            options.closeEndpoint?.();
          }
        }
        return Fiber.interrupt(fiber);
      });
    },
  };
}

export interface EffectWorkerRunnerOptions<Inbound> {
  endpoint: MessagePort | Window;
  onMessage(portId: number, message: Inbound): void | Promise<void>;
  onDisconnect?: (portId: number) => void;
  onError(error: Error): void;
}

export interface EffectWorkerRunnerTransport<Outbound> {
  send(
    portId: number,
    message: Outbound,
    transfers?: readonly Transferable[]
  ): Effect.Effect<void, Error>;
  isClosed(): boolean;
  close(): Effect.Effect<void>;
}

/** Runs Effect's worker-side protocol over a worker global or explicit port. */
export function createEffectWorkerRunnerTransport<Inbound, Outbound>(
  options: EffectWorkerRunnerOptions<Inbound>
): EffectWorkerRunnerTransport<Outbound> {
  const platform = BrowserWorkerRunner.make(options.endpoint);
  const runner = Effect.runSync(platform.start<Outbound, Inbound>());
  let closed = false;
  const run = runner
    .run((portId, message) => {
      const handled = options.onMessage(portId, message);
      return handled instanceof Promise
        ? Effect.promise(() => handled)
        : undefined;
    })
    .pipe(
      Effect.catchCause((cause) =>
        Effect.sync(() => {
          if (!closed) options.onError(asError(Cause.squash(cause)));
        })
      )
    );
  const fiber = Effect.runFork(run);
  const disconnectFiber = runner.disconnects
    ? Effect.runFork(
        Queue.take(runner.disconnects).pipe(
          Effect.tap((portId) =>
            Effect.sync(() => options.onDisconnect?.(portId))
          ),
          Effect.forever
        )
      )
    : undefined;

  return {
    send(portId, message, transfers): Effect.Effect<void, Error> {
      return Effect.suspend(() => {
        if (closed) {
          return Effect.fail(
            new Error('Effect worker runner transport is closed')
          );
        }
        return runner.send(portId, message, transfers);
      });
    },

    isClosed(): boolean {
      return closed;
    },

    close(): Effect.Effect<void> {
      return Effect.suspend(() => {
        closed = true;
        return Effect.all(
          [
            Fiber.interrupt(fiber),
            ...(disconnectFiber ? [Fiber.interrupt(disconnectFiber)] : []),
          ],
          { discard: true }
        );
      });
    },
  };
}

/** Extracts Effect's typed worker failure for telemetry without exposing Effect. */
export function effectWorkerErrorTag(
  error: unknown
): WorkerError['reason']['_tag'] | undefined {
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
