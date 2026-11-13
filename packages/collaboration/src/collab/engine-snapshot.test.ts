import { LoroDoc } from 'loro-crdt';
import { ok } from 'neverthrow';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from 'vitest';
import { SyncEngine } from './engine';
import type { GenericRootSchema } from './shared';
import {
  MockLiveSyncSource,
  MockLoroManager,
  type MockWALStore,
  makeTestWAL,
} from './testing';

describe('SyncEngine periodic snapshots', () => {
  let doc: LoroDoc;
  let engine: SyncEngine<GenericRootSchema, never>;
  let stop: () => void;
  let manager: MockLoroManager;
  let live: MockLiveSyncSource;
  let walStore: MockWALStore<Uint8Array>;
  let save: ReturnType<typeof vi.fn<(bytes: Uint8Array) => Promise<void>>>;
  let flush: MockInstance<() => Promise<void>>;
  let prune: MockInstance<() => Promise<void>>;
  let exported: MockInstance<LoroDoc['export']>;

  beforeEach(() => {
    vi.useFakeTimers();
    doc = new LoroDoc();
    doc.getText('text').insert(0, 'seed');
    doc.commit();
    manager = new MockLoroManager();
    vi.spyOn(manager, 'doc', 'get').mockImplementation(() => doc);
    live = new MockLiveSyncSource();
    const testWal = makeTestWAL(live);
    const { wal } = testWal;
    walStore = testWal.walStore;
    flush = vi.spyOn(wal, 'flush');
    prune = vi.spyOn(wal, 'pruneDelivered');
    save = vi.fn(async (_bytes: Uint8Array) => {});
    exported = vi.spyOn(doc, 'export');
    engine = new SyncEngine<GenericRootSchema, never>({
      loroManager: manager,
      awareness: {
        local: () => ({
          user: { userId: undefined, color: '#000000', peerId: '1' },
          selection: undefined,
        }),
        remote: () => [],
        updateRemoteAwareness: vi.fn(),
        updateLocalAwareness: vi.fn(),
        getEncodedLocalAwareness: vi.fn(() => new Uint8Array()),
        importRemoteAwareness: vi.fn(),
      },
      syncs: { wal, live },
      bindings: { onRemoteState: vi.fn() },
      snapshotStore: { save, load: async () => null, delete: async () => {} },
    });
    stop = () => {
      engine.stop();
      wal.destroy();
    };
    engine.start();
  });

  afterEach(() => {
    stop();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('saves once then skips five idle intervals while continuing WAL flushes', async () => {
    await vi.advanceTimersByTimeAsync(5_000);
    expect(exported).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(prune).toHaveBeenCalledTimes(1);
    const flushed = flush.mock.calls.length;

    await vi.advanceTimersByTimeAsync(25_000);
    expect(exported).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    expect(flush.mock.calls.length - flushed).toBe(5);
  });

  it('prunes a later-delivered WAL row while keeping the saved document idle', async () => {
    live.setPushResult(false);
    doc.getText('text').insert(4, '!');
    doc.commit();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(save).toHaveBeenCalledTimes(1);
    const pending = await walStore.getAll();
    expect(pending).toHaveLength(1);
    expect(pending[0].delivered).toBe(false);

    live.setPushResult(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await walStore.getAll()).toEqual([]);
    expect(exported).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('exports one new snapshot for an uncommitted edit then becomes idle', async () => {
    await vi.advanceTimersByTimeAsync(5_000);
    doc.getText('text').insert(4, '!');
    expect(doc.getPendingTxnLength()).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(20_000);

    expect(exported).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledTimes(2);
    const restored = LoroDoc.fromSnapshot(save.mock.calls[1][0]);
    expect(restored.getText('text').toString()).toBe('seed!');
  });

  it('retries a failed save without pruning or marking the version saved', async () => {
    save.mockRejectedValueOnce(new Error('storage unavailable'));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(prune).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(exported).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledTimes(2);
    expect(prune).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(exported).toHaveBeenCalledTimes(2);
    expect(prune).toHaveBeenCalledTimes(2);
  });

  it('retries when WAL pruning fails after a successful save', async () => {
    prune.mockRejectedValueOnce(new Error('prune unavailable'));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(exported).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledTimes(2);
    expect(prune).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(exported).toHaveBeenCalledTimes(2);
    expect(prune).toHaveBeenCalledTimes(3);
  });

  it('serializes saves and retains an edit made while saving', async () => {
    const release = Promise.withResolvers<void>();
    save.mockImplementationOnce(() => release.promise);
    await vi.advanceTimersByTimeAsync(5_000);
    doc.getText('text').insert(4, '!');
    doc.commit();
    await vi.advanceTimersByTimeAsync(15_000);
    expect(exported).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);

    release.resolve();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(exported).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledTimes(2);
    expect(
      LoroDoc.fromSnapshot(save.mock.calls[0][0]).getText('text').toString()
    ).toBe('seed');
    expect(
      LoroDoc.fromSnapshot(save.mock.calls[1][0]).getText('text').toString()
    ).toBe('seed!');
  });

  it('does not clean a replacement document with the old document save', async () => {
    const release = Promise.withResolvers<void>();
    save.mockImplementationOnce(() => release.promise);
    await vi.advanceTimersByTimeAsync(5_000);
    const replacement = LoroDoc.fromSnapshot(save.mock.calls[0][0]);
    manager.reset.mockImplementationOnce(async () => {
      doc = replacement;
      return ok(undefined);
    });
    await engine.reset();
    const replacementExport = vi.spyOn(replacement, 'export');
    release.resolve();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(replacementExport).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('detects a remote edit without a local dirty notification', async () => {
    await vi.advanceTimersByTimeAsync(5_000);
    const remote = doc.fork();
    remote.getText('text').insert(4, ' remote');
    doc.import(remote.export({ mode: 'update', from: doc.oplogVersion() }));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(exported).toHaveBeenCalledTimes(2);
    expect(
      LoroDoc.fromSnapshot(save.mock.calls[1][0]).getText('text').toString()
    ).toBe('seed remote');
  });

  it('does not mistake checkout and reattach for an unchanged document', async () => {
    const before = doc.frontiers();
    doc.getText('text').insert(4, '!');
    doc.commit();
    await vi.advanceTimersByTimeAsync(5_000);
    doc.checkout(before);
    await vi.advanceTimersByTimeAsync(5_000);
    doc.attach();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(exported).toHaveBeenCalledTimes(3);
  });
});
