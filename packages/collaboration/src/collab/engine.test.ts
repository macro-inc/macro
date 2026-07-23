import { LoroDoc } from 'loro-crdt';
import { err, ResultAsync } from 'neverthrow';
import { describe, expect, it, vi } from 'vitest';
import { SyncEngine } from './engine';
import { LoroManagerError } from './manager';
import type { RawUpdate } from './shared';
import { createNoopLiveSyncSource } from './source';
import {
  MockChatter,
  MockLiveSyncSource,
  MockLoroManager,
  MockWALStore,
  makeTestWAL,
} from './testing';
import { WALSyncer } from './wal';

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

  describe('cross-replica chatter', () => {
    it('broadcasts local updates to the chatter', async () => {
      const source = new MockLiveSyncSource();
      const { wal } = makeTestWAL(source);
      const manager = new MockLoroManager();
      const chatter = new MockChatter();
      const engine = new SyncEngine({
        loroManager: manager,
        awareness: makeAwareness(),
        syncs: { wal, live: source },
        bindings: { onRemoteState: vi.fn() },
        makeChatter: () => chatter,
      });

      engine.start();
      const update = new Uint8Array([1, 2, 3]);
      manager.triggerLocalUpdate(update);

      await vi.waitFor(() =>
        expect(chatter.posted).toContainEqual({ type: 'update', data: update })
      );
    });

    it('applies updates received from another replica', async () => {
      const source = new MockLiveSyncSource();
      const { wal } = makeTestWAL(source);
      const manager = new MockLoroManager();
      const chatter = new MockChatter();
      const engine = new SyncEngine({
        loroManager: manager,
        awareness: makeAwareness(),
        syncs: { wal, live: source },
        bindings: { onRemoteState: vi.fn() },
        makeChatter: () => chatter,
      });

      engine.start();
      const update = new Uint8Array([4, 5, 6]);
      chatter.receive({ type: 'update', data: update });

      await vi.waitFor(() =>
        expect(manager.importUpdate).toHaveBeenCalledWith(update)
      );
    });

    it('stops listening to the chatter on stop', () => {
      const source = new MockLiveSyncSource();
      const { wal } = makeTestWAL(source);
      const manager = new MockLoroManager();
      const chatter = new MockChatter();
      const engine = new SyncEngine({
        loroManager: manager,
        awareness: makeAwareness(),
        syncs: { wal, live: source },
        bindings: { onRemoteState: vi.fn() },
        makeChatter: () => chatter,
      });

      engine.start();
      engine.stop();
      chatter.receive({ type: 'update', data: new Uint8Array([7]) });

      expect(chatter.closed).toBe(true);
      expect(manager.importUpdate).not.toHaveBeenCalled();
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

  it('skips convergence payloads with zero bytes (noop live source)', async () => {
    // Non-propagating AI edit sessions run the engine over a noop live
    // source whose requestUpdatesSince/requestSnapshot answer with an empty
    // Uint8Array — not a valid Loro payload. Startup convergence must skip
    // it rather than import → throw → reset in a loop.
    const live = createNoopLiveSyncSource('doc-1');
    const wal = new WALSyncer<RawUpdate>(
      new MockWALStore<RawUpdate>(),
      (updates) => live.pushUpdate(updates)
    );
    const manager = new MockLoroManager();
    const engine = new SyncEngine({
      loroManager: manager,
      awareness: makeAwareness(),
      syncs: { wal, live },
      bindings: { onRemoteState: vi.fn() },
    });

    engine.start();
    await new Promise((resolve) => setTimeout(resolve));

    expect(manager.importUpdate).not.toHaveBeenCalled();
    expect(manager.reset).not.toHaveBeenCalled();
    expect(engine.isRunning).toBe(true);
    engine.stop();
    wal.destroy();
  });

  it('converges instead of resetting when a remote update is causally pending', async () => {
    const source = new MockLiveSyncSource();
    const { wal } = makeTestWAL(source);
    const manager = new MockLoroManager();
    const engine = new SyncEngine({
      loroManager: manager,
      awareness: makeAwareness(),
      syncs: { wal, live: source },
      bindings: { onRemoteState: vi.fn() },
    });

    engine.start();
    // Let the startup convergence fully settle, so the pending-triggered
    // convergence below isn't coalesced onto it.
    await new Promise((resolve) => setTimeout(resolve));

    manager.importUpdate.mockReturnValueOnce(
      err([{ code: LoroManagerError.ImportPending, message: 'pending' }])
    );
    source.emit({ type: 'update', update: new Uint8Array([9]) });

    // A pending import triggers a fresh convergence, not a reset.
    await vi.waitFor(() =>
      expect(source.requestUpdatesSince).toHaveBeenCalledTimes(2)
    );
    expect(manager.reset).not.toHaveBeenCalled();
    expect(source.requestSnapshot).not.toHaveBeenCalled();
  });

  it('runs a fresh convergence for a reconnect that arrives mid-flight', async () => {
    const source = new MockLiveSyncSource();
    const firstRequest = Promise.withResolvers<Uint8Array<ArrayBuffer>>();
    source.requestUpdatesSince.mockReturnValueOnce(
      ResultAsync.fromSafePromise(firstRequest.promise)
    );
    const { wal } = makeTestWAL(source);
    const manager = new MockLoroManager();
    const engine = new SyncEngine({
      loroManager: manager,
      awareness: makeAwareness(),
      syncs: { wal, live: source },
      bindings: { onRemoteState: vi.fn() },
    });

    engine.start();
    expect(source.requestUpdatesSince).toHaveBeenCalledOnce();

    // Reconnect while the startup convergence is still in flight: coalesced
    // for now, but a fresh pass must follow once the in-flight one settles.
    source.emit({
      type: 'reconnect',
      snapshot: emptySnapshot(),
      awareness: new Uint8Array(),
    });
    expect(source.requestUpdatesSince).toHaveBeenCalledOnce();

    firstRequest.resolve(new Uint8Array());
    await vi.waitFor(() =>
      expect(source.requestUpdatesSince).toHaveBeenCalledTimes(2)
    );
  });

  it('does not apply a late startup convergence response after stop', async () => {
    const source = new MockLiveSyncSource();
    const pendingUpdate = Promise.withResolvers<Uint8Array<ArrayBuffer>>();
    source.requestUpdatesSince.mockReturnValueOnce(
      ResultAsync.fromSafePromise(pendingUpdate.promise)
    );
    const { wal } = makeTestWAL(source);
    const manager = new MockLoroManager();
    const engine = new SyncEngine({
      loroManager: manager,
      awareness: makeAwareness(),
      syncs: { wal, live: source },
      bindings: { onRemoteState: vi.fn() },
    });

    engine.start();
    expect(source.requestUpdatesSince).toHaveBeenCalledOnce();
    engine.stop();

    pendingUpdate.resolve(new Uint8Array([1, 2, 3]));
    await pendingUpdate.promise;
    await Promise.resolve();

    expect(manager.importUpdate).not.toHaveBeenCalled();
  });
});
