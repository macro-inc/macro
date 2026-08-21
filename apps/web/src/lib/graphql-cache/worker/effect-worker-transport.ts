import * as BrowserWorker from '@effect/platform-browser/BrowserWorker';
import * as BrowserWorkerRunner from '@effect/platform-browser/BrowserWorkerRunner';
import * as Cause from 'effect/Cause';
import * as Effect from 'effect/Effect';
import * as Fiber from 'effect/Fiber';
import * as Queue from 'effect/Queue';
import * as WorkerApi from 'effect/unstable/workers/Worker';
import type { WorkerError } from 'effect/unstable/workers/WorkerError';

export type BrowserWorkerEndpoint = Worker | SharedWorker | MessagePort;

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
  send(message: Outbound, transfers?: readonly Transferable[]): Promise<void>;
  /** Synchronous send for existing state-machine adapters. */
  sendUnsafe(message: Outbound, transfers?: readonly Transferable[]): void;
  /** Closes the Effect scope and then the caller-owned browser endpoint. */
  close(): Promise<void>;
}

const asError = (cause: unknown): Error =>
  cause instanceof Error ? cause : new Error(String(cause));

const originalWorkerError = (error: unknown): Error => {
  if (
    typeof error === 'object' &&
    error !== null &&
    'reason' in error &&
    typeof error.reason === 'object' &&
    error.reason !== null &&
    'cause' in error.reason &&
    error.reason.cause instanceof Error
  ) {
    return error.reason.cause;
  }
  return asError(error);
};

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
          // `Worker.run` opens its internal ready latch after `onSpawn`
          // completes, then flushes buffered sends. Resolve in the next task
          // so callers observe the fully-ready transport.
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
      const exit = await Effect.runPromiseExit(
        backing.send(message, transfers)
      );
      if (exit._tag === 'Failure') {
        throw originalWorkerError(Cause.squash(exit.cause));
      }
    },

    sendUnsafe(message: Outbound, transfers?: readonly Transferable[]): void {
      if (closed) throw new Error('Effect worker transport is closed');
      const exit = Effect.runSyncExit(backing.send(message, transfers));
      if (exit._tag === 'Failure') {
        throw originalWorkerError(Cause.squash(exit.cause));
      }
    },

    close(): Promise<void> {
      if (closePromise) return closePromise;
      closed = true;
      if (!readySettled) {
        readySettled = true;
        rejectReady(new Error('Effect worker transport closed before ready'));
      }
      messageTarget.removeEventListener('messageerror', onMessageError);
      // Preserve the browser adapter's synchronous close behavior while still
      // speaking Effect's explicit close protocol to the runner.
      try {
        messageTarget.postMessage([1]);
      } catch {
        // Endpoint teardown remains authoritative if close framing fails.
      } finally {
        options.closeEndpoint?.();
      }
      closePromise = Effect.runPromise(Fiber.interrupt(fiber));
      return closePromise;
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
  sendUnsafe(
    portId: number,
    message: Outbound,
    transfers?: readonly Transferable[]
  ): void;
  close(): Promise<void>;
}

/** Runs Effect's worker-side protocol over a worker global or explicit port. */
export function createEffectWorkerRunnerTransport<Inbound, Outbound>(
  options: EffectWorkerRunnerOptions<Inbound>
): EffectWorkerRunnerTransport<Outbound> {
  const platform = BrowserWorkerRunner.make(options.endpoint);
  const runner = Effect.runSync(platform.start<Outbound, Inbound>());
  let closed = false;
  let closePromise: Promise<void> | undefined;
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
    sendUnsafe(portId, message, transfers): void {
      if (closed) throw new Error('Effect worker runner transport is closed');
      Effect.runSync(runner.send(portId, message, transfers));
    },

    close(): Promise<void> {
      if (closePromise) return closePromise;
      closed = true;
      closePromise = Effect.runPromise(
        Effect.all(
          [
            Fiber.interrupt(fiber),
            ...(disconnectFiber ? [Fiber.interrupt(disconnectFiber)] : []),
          ],
          { discard: true }
        )
      );
      return closePromise;
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
