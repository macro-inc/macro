import { describe, expect, it, vi } from 'vitest';
import { SyncEngine } from './engine';
import type { SyncSource } from './source';

function makeSource(overrides: Partial<SyncSource> = {}): SyncSource {
  return {
    documentId: 'doc-1',
    pushUpdate: vi.fn(() => Promise.resolve(true)),
    pushAwareness: vi.fn(),
    registerPeerId: vi.fn(),
    listen: vi.fn(),
    reconnect: vi.fn(),
    requestSnapshot: vi.fn(() => okAsync(new Uint8Array())),
    requestUpdatesSince: vi.fn(() => okAsync(new Uint8Array())),
    status: () => 0 as any,
    ...overrides,
  } as unknown as SyncSource;
}

function makeLoroManager(initialized = true) {
  const doc = {
    subscribeLocalUpdates: vi.fn(() => () => {}),
    frontiers: vi.fn(() => []),
  };
  return {
    isInitialized: () => initialized,
    getDoc: () => doc,
    getPeerId: () => BigInt(1),
    state: () => undefined,
    importUpdate: vi.fn(() => ({ isErr: () => false })),
    syncToLoro: vi.fn(() => okAsync({ isErr: () => false })),
    reset: vi.fn(() => okAsync({ isErr: () => false })),
  } as any;
}

function makeAwareness() {
  return {
    local: () => undefined,
    updateLocalAwareness: vi.fn(),
    getEncodedLocalAwareness: vi.fn(() => new Uint8Array()),
    importRemoteAwareness: vi.fn(),
  } as any;
}

describe('SyncEngine', () => {
  it('registers peer id and calls onRunningChange(true) on start', () => {
    const source = makeSource();
    const onRunningChange = vi.fn();
    const engine = new SyncEngine(
      makeLoroManager(),
      makeAwareness(),
      source,
      { onRemoteState: vi.fn() },
      () => false,
      { onRunningChange }
    );

    const started = engine.start();

    expect(started).toBe(true);
    expect(source.registerPeerId).toHaveBeenCalledWith(BigInt(1));
    expect(engine.isRunning).toBe(true);
    expect(onRunningChange).toHaveBeenCalledWith(true);
  });

  it('calls reconnect when pushUpdate returns false', async () => {
    const source = makeSource({
      pushUpdate: vi.fn(() => Promise.resolve(false)),
    });
    const manager = makeLoroManager();
    const engine = new SyncEngine(manager, makeAwareness(), source, {
      onRemoteState: vi.fn(),
    });

    engine.start();

    const onUpdate = vi.mocked(manager.getDoc().subscribeLocalUpdates).mock.calls[0][0];
    await onUpdate(new Uint8Array([1, 2, 3]));

    expect(source.reconnect).toHaveBeenCalled();
  });

  it('does not start when manager is not initialized', () => {
    const source = makeSource();
    const engine = new SyncEngine(makeLoroManager(false), makeAwareness(), source, {
      onRemoteState: vi.fn(),
    });

    const started = engine.start();

    expect(started).toBe(false);
    expect(source.registerPeerId).not.toHaveBeenCalled();
  });
});
