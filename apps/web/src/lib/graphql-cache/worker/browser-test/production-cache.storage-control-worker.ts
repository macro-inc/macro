/// <reference lib="webworker" />

import { match } from 'ts-pattern';
import { loadBrowserTestCacheWasm } from './browser-test-wasm-module';
import type { CacheWasmBuildInfo } from './wasm-build-compatibility';

type StorageControlRequest = {
  id: number;
  scope: string;
  kind: 'verify-artifacts' | 'incompatible-namespace' | 'corrupt-queue-payload';
};

type StorageControlResponse =
  | { id: number; ok: true; wasmUrl: string; buildInfo: CacheWasmBuildInfo }
  | { id: number; ok: false; error: string };

const worker = self as unknown as DedicatedWorkerGlobalScope;

worker.onmessage = (event: MessageEvent<StorageControlRequest>) => {
  const request = event.data;
  void (async () => {
    const { module, wasmUrl, buildInfo } = await loadBrowserTestCacheWasm();
    await match(request)
      .with({ kind: 'verify-artifacts' }, () => undefined)
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
      buildInfo,
    } satisfies StorageControlResponse);
  })().catch((error: unknown) => {
    worker.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    } satisfies StorageControlResponse);
  });
};
