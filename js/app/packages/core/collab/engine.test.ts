import { LoroDoc } from 'loro-crdt';
import { describe, expect, it, vi } from 'vitest';
import { NoopWALSyncSource, SyncEngine } from './engine';
import {
  MockLoroManager,
  MockLiveSyncSource,
  MockWALStore,
  MockWALSyncSource,
} from './testing';
import { IDBWALSyncSource } from './wal';

const emptySnapshot = () => new LoroDoc().export({ mode: 'snapshot' });

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
    const source = new MockLiveSyncSource();
    const manager = new MockLoroManager();
    const onRunningChange = vi.fn();
    const engine = new SyncEngine({
      loroManager: manager,
      awareness: makeAwareness(),
      syncs: { wal: NoopWALSyncSource(source), live: source },
      bindings: { onRemoteState: vi.fn() },
      readonly: () => false,
      onRunningChange,
    });

    const started = engine.start();

    expect(started).toBe(true);
    expect(source.registerPeerId).toHaveBeenCalledWith(BigInt(1));
    expect(engine.isRunning).toBe(true);
    expect(onRunningChange).toHaveBeenCalledWith(true);
  });

  it('forwards every local update to the wal only', async () => {
    const source = new MockLiveSyncSource();
    const wal = new MockWALSyncSource();
    const manager = new MockLoroManager();
    const engine = new SyncEngine({
      loroManager: manager,
      awareness: makeAwareness(),
      syncs: { wal, live: source },
      bindings: { onRemoteState: vi.fn() },
    });

    engine.start();
    const update = new Uint8Array([1, 2, 3]);
    manager.triggerLocalUpdate(update);

    await vi.waitFor(() => expect(wal.pushUpdate).toHaveBeenCalledWith(update));
    expect(source.pushUpdate).not.toHaveBeenCalled();
  });

  describe('integration with WAL', () => {
    it('local edit is persisted to WAL and delivered to live', async () => {
      const live = new MockLiveSyncSource();
      const walStore = new MockWALStore();
      const wal = new IDBWALSyncSource(live, walStore);
      const manager = new MockLoroManager();
      const engine = new SyncEngine({
        loroManager: manager,
        awareness: makeAwareness(),
        syncs: { wal, live },
        bindings: { onRemoteState: vi.fn() },
      });

      engine.start();
      const update = new Uint8Array([1, 2, 3]);
      manager.triggerLocalUpdate(update);

      await vi.waitFor(async () => {
        expect(live.pushUpdate).toHaveBeenCalledTimes(1);
        expect(await walStore.count()).toBe(0);
      });
    });

    it('local edit stays in WAL when live is down, clears on reconnect', async () => {
      const live = new MockLiveSyncSource();
      live.setPushResult(false);
      const walStore = new MockWALStore();
      const wal = new IDBWALSyncSource(live, walStore);
      const manager = new MockLoroManager();
      const engine = new SyncEngine({
        loroManager: manager,
        awareness: makeAwareness(),
        syncs: { wal, live },
        bindings: { onRemoteState: vi.fn() },
      });

      engine.start();
      manager.triggerLocalUpdate(new Uint8Array([1, 2, 3]));
      await vi.waitFor(async () => expect(await walStore.count()).toBe(1));
      await wal.pendingFlush; // wait for the failing flush to fully settle

      live.setPushResult(true);
      live.emit({ type: 'reconnect', snapshot: emptySnapshot(), awareness: new Uint8Array() });
      await vi.waitFor(async () => expect(await walStore.count()).toBe(0));
    });
  });

  it('does not start when manager is not initialized', () => {
    const source = new MockLiveSyncSource();
    const engine = new SyncEngine({
      loroManager: new MockLoroManager(false),
      awareness: makeAwareness(),
      syncs: { wal: NoopWALSyncSource(source), live: source },
      bindings: { onRemoteState: vi.fn() },
    });

    const started = engine.start();

    expect(started).toBe(false);
    expect(source.registerPeerId).not.toHaveBeenCalled();
  });
});
