/// <reference lib="webworker" />

import type {
  CoordinatorToTabEnvelope,
  TabToCoordinatorEnvelope,
} from './coordinator-protocol';
import {
  type CoordinatorMessagePort,
  CoordinatorRouter,
} from './coordinator-router';
import {
  createEffectWorkerRunnerTransport,
  type EffectWorkerRunnerTransport,
} from './effect-worker-transport';

export interface CacheCoordinatorRuntimeOptions {
  endpoint?: MessagePort | Window;
  router?: CoordinatorRouter;
}

/** Installs the SharedWorker-side Effect runner around CoordinatorRouter. */
export function installCacheCoordinatorWorker(
  options: CacheCoordinatorRuntimeOptions = {}
): EffectWorkerRunnerTransport<CoordinatorToTabEnvelope> {
  const router = options.router ?? new CoordinatorRouter();
  const ports = new Map<number, CoordinatorMessagePort>();
  let runner!: EffectWorkerRunnerTransport<CoordinatorToTabEnvelope>;

  const portFor = (portId: number): CoordinatorMessagePort => {
    const existing = ports.get(portId);
    if (existing) return existing;
    const port: CoordinatorMessagePort = {
      onmessage: null,
      onmessageerror: null,
      postMessage(message: unknown, transfers?: Transferable[]): void {
        runner.sendUnsafe(
          portId,
          message as CoordinatorToTabEnvelope,
          transfers
        );
      },
      start(): void {},
      close(): void {
        ports.delete(portId);
      },
    };
    ports.set(portId, port);
    router.connect(port);
    return port;
  };

  runner = createEffectWorkerRunnerTransport<
    TabToCoordinatorEnvelope,
    CoordinatorToTabEnvelope
  >({
    endpoint: options.endpoint ?? (self as unknown as Window),
    onMessage(portId, message) {
      portFor(portId).onmessage?.({
        data: message,
        ports: [],
      } as unknown as MessageEvent<unknown>);
    },
    onDisconnect(portId) {
      const port = ports.get(portId);
      ports.delete(portId);
      port?.onmessageerror?.({} as MessageEvent);
    },
    onError(error) {
      for (const port of ports.values()) {
        port.onmessageerror?.({ data: error } as MessageEvent);
      }
      ports.clear();
    },
  });

  return runner;
}
