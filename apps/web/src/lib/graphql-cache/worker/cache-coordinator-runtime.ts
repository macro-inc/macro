/// <reference lib="webworker" />

import * as Effect from 'effect/Effect';
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
  const closedPortIds = new Set<number>();
  let runner!: EffectWorkerRunnerTransport<CoordinatorToTabEnvelope>;

  const portFor = (portId: number): CoordinatorMessagePort => {
    const existing = ports.get(portId);
    if (existing) return existing;
    const port: CoordinatorMessagePort = {
      onmessage: null,
      onmessageerror: null,
      postMessage(message: unknown, transfers?: Transferable[]): void {
        try {
          Effect.runSync(
            runner.send(portId, message as CoordinatorToTabEnvelope, transfers)
          );
        } catch (error) {
          if (ports.get(portId) !== port) return;
          ports.delete(portId);
          closedPortIds.add(portId);
          port.onmessageerror?.({ data: error } as MessageEvent);
        }
      },
      start(): void {},
      close(): void {
        if (ports.get(portId) === port) ports.delete(portId);
        closedPortIds.add(portId);
      },
    };
    closedPortIds.delete(portId);
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
      if (closedPortIds.has(portId)) return;
      portFor(portId).onmessage?.({
        data: message,
        ports: [],
      } as unknown as MessageEvent<unknown>);
    },
    onDisconnect(portId) {
      const port = ports.get(portId);
      ports.delete(portId);
      closedPortIds.add(portId);
      port?.onmessageerror?.({} as MessageEvent);
    },
    onError(error) {
      for (const [portId, port] of ports) {
        ports.delete(portId);
        closedPortIds.add(portId);
        port.onmessageerror?.({ data: error } as MessageEvent);
      }
    },
  });

  return runner;
}
