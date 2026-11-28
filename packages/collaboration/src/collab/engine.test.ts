import { Telemetry } from '@macro-inc/observability';
import { LoroDoc } from 'loro-crdt';
import { err, ok, ResultAsync } from 'neverthrow';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SyncEngine } from './engine';
import { LoroManagerError } from './manager';
import type { RawUpdate } from './shared';
import { createNoopLiveSyncSource } from './source';
import {
  MockChatter,
  MockLiveSyncSource,
  MockLoroManager,
  MockSnapshotStore,
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

describe('SyncEngine health telemetry', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('times only actual export, bounds samples, and preserves persistence when telemetry throws', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValueOnce(0);
    const sample = vi
      .spyOn(Telemetry, 'recordAnonymousSample')
      .mockImplementationOnce(() => {
        throw new Error('synthetic exporter failure');
      });
    const source = new MockLiveSyncSource();
    const { wal } = makeTestWAL(source);
    const manager = new MockLoroManager();
    const doc = new LoroDoc();
    vi.spyOn(manager, 'doc', 'get').mockReturnValue(doc);
    let exportCpuMs = 0;
    vi.spyOn(performance, 'now').mockImplementation(
      () => Date.now() + exportCpuMs
    );
    const snapshot = new Uint8Array([1, 2, 3]);
    const exportSnapshot = vi
      .spyOn(doc, 'export')
      .mockImplementationOnce(() => {
        exportCpuMs += 35;
        return snapshot;
      })
      .mockImplementation(() => snapshot);
    const snapshotStore = new MockSnapshotStore<RawUpdate>();
    const save = vi.spyOn(snapshotStore, 'save');
    const prune = vi.spyOn(wal, 'pruneDelivered');
    const engine = new SyncEngine({
      loroManager: manager,
      awareness: makeAwareness(),
      syncs: { wal, live: source },
      bindings: { onRemoteState: () => {} },
      snapshotStore,
    });

    engine.start();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sample).toHaveBeenNthCalledWith(1, 'collab.snapshot.export', {
      'collab.snapshot.export.outcome': 'exported',
      'collab.snapshot.export.elapsed_bucket': '10_to_49ms',
      'collab.engine.sample_rate': 0.05,
    });
    expect(save).toHaveBeenCalledWith(snapshot);
    expect(prune).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(55_000);
    expect(sample).toHaveBeenCalledOnce();
    const savesBeforeFailure = save.mock.calls.length;
    exportSnapshot.mockImplementationOnce(() => {
      exportCpuMs += 300;
      throw new Error('synthetic snapshot detail');
    });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sample).toHaveBeenNthCalledWith(2, 'collab.snapshot.export', {
      'collab.snapshot.export.outcome': 'failed',
      'collab.snapshot.export.elapsed_bucket': '250_to_999ms',
      'collab.engine.sample_rate': 0.05,
    });
    expect(save).toHaveBeenCalledTimes(savesBeforeFailure);
    expect(prune).toHaveBeenCalledTimes(savesBeforeFailure);

    save.mockRejectedValueOnce(new Error('synthetic disk failure'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sample).toHaveBeenNthCalledWith(3, 'collab.snapshot.export', {
      'collab.snapshot.export.outcome': 'exported',
      'collab.snapshot.export.elapsed_bucket': 'under_10ms',
      'collab.engine.sample_rate': 0.05,
    });
    await vi.advanceTimersByTimeAsync(180_000);
    expect(sample).toHaveBeenCalledTimes(4);
    expect(exportSnapshot).toHaveBeenCalledTimes(61);
    engine.stop();
    wal.destroy();
  });

  it('counts writable local Loro batches across a reset and reports once at owner stop', async () => {
    const sample = vi.spyOn(Telemetry, 'recordAnonymousSample');
    vi.spyOn(Math, 'random').mockReturnValueOnce(0);
    let elapsed = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
    const source = new MockLiveSyncSource();
    const { wal } = makeTestWAL(source);
    const manager = new MockLoroManager();
    const doc = new LoroDoc();
    vi.spyOn(manager, 'doc', 'get').mockReturnValue(doc);
    let readonly = false;
    const engine = new SyncEngine({
      loroManager: manager,
      awareness: makeAwareness(),
      syncs: { wal, live: source },
      bindings: { onRemoteState: () => {} },
      readonly: () => readonly,
    });

    engine.start();
    doc.getText('synthetic').insert(0, 'before reset');
    doc.commit();
    await engine.reset(() =>
      ResultAsync.fromSafePromise(Promise.resolve(emptySnapshot()))
    );
    expect(sample).not.toHaveBeenCalled();
    expect(engine.isRunning).toBe(true);

    const remote = new LoroDoc();
    remote.getText('synthetic').insert(0, 'remote');
    doc.import(remote.export({ mode: 'snapshot' }));
    doc.getText('synthetic').insert(0, 'after reset');
    doc.commit();
    readonly = true;
    doc.getText('synthetic').insert(0, 'readonly');
    doc.commit();
    source.emit({
      type: 'reconnect',
      snapshot: emptySnapshot(),
      awareness: new Uint8Array(),
    });
    elapsed = 15_000;
    engine.stop();
    engine.stop();
    await wal.flushPending();
    expect(sample).toHaveBeenCalledExactlyOnceWith('collab.engine.window', {
      'collab.engine.elapsed_bucket': '10_to_59s',
      'collab.engine.local_batches_per_minute_bucket': '1_to_9',
      'collab.engine.reconnect_count_bucket': 'one',
      'collab.engine.reset_count_bucket': 'one',
      'collab.engine.sample_rate': 0.05,
    });
    wal.destroy();
  });

  it.each([0, 1])(
    'reports idle windows only for sampled engines (%s)',
    (random) => {
      const sample = vi.spyOn(Telemetry, 'recordAnonymousSample');
      vi.spyOn(Math, 'random').mockReturnValueOnce(random);
      const source = new MockLiveSyncSource();
      const { wal } = makeTestWAL(source);
      const engine = new SyncEngine({
        loroManager: new MockLoroManager(),
        awareness: makeAwareness(),
        syncs: { wal, live: source },
        bindings: { onRemoteState: () => {} },
      });
      engine.start();
      engine.stop();
      if (random === 0) {
        expect(sample).toHaveBeenCalledExactlyOnceWith('collab.engine.window', {
          'collab.engine.elapsed_bucket': 'under_10s',
          'collab.engine.local_batches_per_minute_bucket': 'none',
          'collab.engine.reconnect_count_bucket': 'none',
          'collab.engine.reset_count_bucket': 'none',
          'collab.engine.sample_rate': 0.05,
        });
      } else {
        expect(sample).not.toHaveBeenCalled();
      }
      wal.destroy();
    }
  );
});

describe('SyncEngine', () => {
  it.each(['snapshot', 'manager'] as const)(
    'does not replace or restart a stopped owner during %s recovery',
    async (phase) => {
      const source = new MockLiveSyncSource();
      const { wal } = makeTestWAL(source);
      const manager = new MockLoroManager();
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const snapshot = emptySnapshot();
      if (phase === 'snapshot')
        source.requestSnapshot.mockImplementationOnce(() =>
          ResultAsync.fromSafePromise(
            (async () => {
              entered.resolve();
              await release.promise;
              return snapshot;
            })()
          )
        );
      else
        manager.reset.mockImplementationOnce(async () => {
          entered.resolve();
          await release.promise;
          return ok(undefined);
        });
      const engine = new SyncEngine({
        loroManager: manager,
        awareness: makeAwareness(),
        syncs: { wal, live: source },
        bindings: { onRemoteState: () => {} },
      });
      engine.start();
      const resetting = engine.reset();
      await entered.promise;
      engine.stop();
      release.resolve();
      await resetting;
      expect(engine.isRunning).toBe(false);
      expect(manager.reset).toHaveBeenCalledTimes(phase === 'snapshot' ? 0 : 1);
      wal.destroy();
    }
  );
  it('does not import a queued remote packet after its document owner stops', async () => {
    const source = new MockLiveSyncSource();
    const { wal } = makeTestWAL(source);
    const manager = new MockLoroManager();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    manager.syncToLoro.mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
      return ok(undefined);
    });
    const engine = new SyncEngine({
      loroManager: manager,
      awareness: makeAwareness(),
      syncs: { wal, live: source },
      bindings: { onRemoteState: () => {} },
    });
    engine.start();
    const write = engine.syncStateToLoro({});
    await entered.promise;
    source.emit({ type: 'update', update: new Uint8Array([1, 2, 3]) });
    engine.stop();
    release.resolve();
    await write;
    expect(manager.importUpdate).not.toHaveBeenCalled();
    wal.destroy();
  });
  it('builds a queued write from the state stored when its turn comes', async () => {
    const source = new MockLiveSyncSource();
    const { wal } = makeTestWAL(source);
    const manager = new MockLoroManager();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    manager.syncToLoro.mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
      return ok(undefined);
    });
    const engine = new SyncEngine({
      loroManager: manager,
      awareness: makeAwareness(),
      syncs: { wal, live: source },
      bindings: { onRemoteState: () => {} },
    });
    engine.start();
    const first = engine.syncStateToLoro({ written: 'first' });
    await entered.promise;
    const build = vi.fn((stored: unknown) => ({ builtOn: stored }));
    const second = engine.syncStateToLoro(build as never);
    manager.state = {
      state: { written: 'first' },
      metadata: { direction: 'TO_LORO' },
    } as never;
    expect(build).not.toHaveBeenCalled();

    release.resolve();
    await Promise.all([first, second]);

    expect(build).toHaveBeenCalledWith({ written: 'first' });
    expect(manager.syncToLoro).toHaveBeenLastCalledWith({
      builtOn: { written: 'first' },
    });
    wal.destroy();
  });
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
