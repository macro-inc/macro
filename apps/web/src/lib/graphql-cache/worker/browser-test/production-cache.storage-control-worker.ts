/// <reference lib="webworker" />

import { match } from 'ts-pattern';
import { loadBrowserTestCacheWasm } from './browser-test-wasm-module';

type StorageControlRequest = {
  id: number;
  scope: string;
  kind: 'incompatible-namespace' | 'corrupt-queue-payload';
};

type StorageControlResponse =
  | { id: number; ok: true; wasmUrl: string }
  | { id: number; ok: false; error: string };

const worker = self as unknown as DedicatedWorkerGlobalScope;

worker.onmessage = (event: MessageEvent<StorageControlRequest>) => {
  const request = event.data;
  void (async () => {
    const { module, wasmUrl } = await loadBrowserTestCacheWasm();
    await match(request)
      .with({ kind: 'incompatible-namespace' }, ({ scope }) =>
        module.browserTestMakeNamespaceIncompatible(scope)
      )
      .with({ kind: 'corrupt-queue-payload' }, ({ scope }) =>
        module.browserTestCorruptQueuePayload(scope)
      )
      .exhaustive();
    worker.postMessage({
      id: request.id,
      ok: true,
      wasmUrl,
    } satisfies StorageControlResponse);
  })().catch((error: unknown) => {
    worker.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    } satisfies StorageControlResponse);
  });
};
