import { LoroDoc } from 'loro-crdt';
import { describe, expect, it, vi } from 'vitest';
import { SyncEngine } from './engine';
import { MockLiveSyncSource, MockLoroManager, makeTestWAL } from './testing';

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
    const { wal } = makeTestWAL(source);
    const engine = new SyncEngine({
      loroManager: manager,
      awareness: makeAwareness(),
      syncs: { wal, live: source },
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
    const { wal } = makeTestWAL(source);
    const appendSpy = vi.spyOn(wal, 'append');
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

    await vi.waitFor(() => expect(appendSpy).toHaveBeenCalledWith(update));
    expect(source.pushUpdate).not.toHaveBeenCalled();
  });

  describe('integration with WAL', () => {
    it('local edit is persisted to WAL and delivered to live', async () => {
      const live = new MockLiveSyncSource();
      const { wal, walStore } = makeTestWAL(live);
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
        expect(live.pushUpdate).toHaveBeenCalledOnce();
        const entries = await walStore.getAll();
        expect(entries.every((e) => e.delivered)).toBe(true);
      });
    });

    it('local edit stays in WAL when live is down, clears on reconnect', async () => {
      const live = new MockLiveSyncSource();
      live.setPushResult(false);
      const { wal, walStore } = makeTestWAL(live);
      const manager = new MockLoroManager();
      const engine = new SyncEngine({
        loroManager: manager,
        awareness: makeAwareness(),
        syncs: { wal, live },
        bindings: { onRemoteState: vi.fn() },
      });

      engine.start();
      manager.triggerLocalUpdate(new Uint8Array([1, 2, 3]));
      await vi.waitFor(async () => {
        const entries = await walStore.getAll();
        expect(entries.filter((e) => !e.delivered).length).toBe(1);
      });
      await wal.pendingFlush;

      live.setPushResult(true);
      live.emit({
        type: 'reconnect',
        snapshot: emptySnapshot(),
        awareness: new Uint8Array(),
      });
      await vi.waitFor(async () => {
        const entries = await walStore.getAll();
        expect(entries.every((e) => e.delivered)).toBe(true);
      });
    });
  });

  it('does not start when manager is not initialized', () => {
    const source = new MockLiveSyncSource();
    const { wal } = makeTestWAL(source);
    const engine = new SyncEngine({
      loroManager: new MockLoroManager(false),
      awareness: makeAwareness(),
      syncs: { wal, live: source },
      bindings: { onRemoteState: vi.fn() },
    });

    const started = engine.start();

    expect(started).toBe(false);
    expect(source.registerPeerId).not.toHaveBeenCalled();
  });
});
