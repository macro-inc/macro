import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const load = vi.hoisted(() => vi.fn());
vi.mock('./browser-test-wasm-module', () => ({
  loadBrowserTestCacheWasm: load,
}));
const hooks = {
  browserTestMakeNamespaceIncompatible: vi.fn(async () => {}),
  browserTestCorruptQueuePayload: vi.fn(async () => {}),
};
const buildInfo = {
  packageVersion: '0.6.15',
  schemaHash: 'a'.repeat(64),
  schemaCompatibilityEpoch: 2,
  formatVersion: 3,
  storageSchemaVersion: 11,
};
let worker: {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage: ReturnType<typeof vi.fn>;
};

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  worker = { onmessage: null, postMessage: vi.fn() };
  vi.stubGlobal('self', worker);
  load.mockResolvedValue({ module: hooks, wasmUrl: 'hooks.wasm', buildInfo });
  await import('./production-cache.storage-control-worker');
});
afterEach(() => vi.unstubAllGlobals());

function send(kind: string) {
  worker.onmessage?.(
    new MessageEvent('message', {
      data: { id: 1, scope: 'fixture-only', kind },
    })
  );
}

describe('storage-control preflight', () => {
  it('verifies the artifact pair without invoking any storage hook', async () => {
    send('verify-artifacts');
    await vi.waitFor(() =>
      expect(worker.postMessage).toHaveBeenCalledWith({
        id: 1,
        ok: true,
        wasmUrl: 'hooks.wasm',
        buildInfo,
      })
    );
    expect(hooks.browserTestMakeNamespaceIncompatible).not.toHaveBeenCalled();
    expect(hooks.browserTestCorruptQueuePayload).not.toHaveBeenCalled();
  });

  it.each([
    'verify-artifacts',
    'incompatible-namespace',
    'corrupt-queue-payload',
  ])('stops %s when artifact verification fails', async (kind) => {
    load.mockRejectedValue(new Error('Cache recovery fixture WASM mismatch'));
    send(kind);
    await vi.waitFor(() =>
      expect(worker.postMessage).toHaveBeenCalledWith({
        id: 1,
        ok: false,
        error: 'Cache recovery fixture WASM mismatch',
      })
    );
    expect(hooks.browserTestMakeNamespaceIncompatible).not.toHaveBeenCalled();
    expect(hooks.browserTestCorruptQueuePayload).not.toHaveBeenCalled();
  });

  it.each([
    ['incompatible-namespace', 'browserTestMakeNamespaceIncompatible'],
    ['corrupt-queue-payload', 'browserTestCorruptQueuePayload'],
  ] as const)('runs %s only after verification', async (kind, hook) => {
    send(kind);
    await vi.waitFor(() =>
      expect(worker.postMessage).toHaveBeenCalledWith({
        id: 1,
        ok: true,
        wasmUrl: 'hooks.wasm',
        buildInfo,
      })
    );
    expect(hooks[hook]).toHaveBeenCalledWith('fixture-only');
    expect(load.mock.invocationCallOrder[0]).toBeLessThan(
      hooks[hook].mock.invocationCallOrder[0]
    );
  });
});
