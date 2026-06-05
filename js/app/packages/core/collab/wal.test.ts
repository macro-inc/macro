import { describe, expect, it, vi } from 'vitest';
import { MockLiveSyncSource, MockWALStore } from './testing';
import { IDBWALSyncSource } from './wal';

function makeWAL(live: MockLiveSyncSource) {
  const walStore = new MockWALStore();
  const wal = new IDBWALSyncSource(live, walStore);
  return { wal, walStore };
}

async function undeliveredCount(walStore: MockWALStore): Promise<number> {
  const entries = await walStore.getAll();
  return entries.filter((e) => !e.delivered).length;
}

// Flush retry logic:
// When pushUpdate is called while a flush is already running:
//   1. isFlushing = true — the new flush() call returns immediately at the guard
//   2. hasNewPending = true — set by pushUpdate to mark that something new arrived
// When the current flush finishes:
//   - If it succeeded (delivered everything) AND hasNewPending is true → runs flush() again
//     to pick up what arrived during the in-flight flush
//   - If it failed (network down) → doesn't re-run, leaves items in the store for the
//     next reconnect event to trigger
//
// WAL entries are marked delivered (not deleted) on ack. They are only dropped when
// pruneDelivered() is called by the snapshot tick after a durable snapshot save.

describe('IDBWALSyncSource', () => {
  it('persists before delivering, marks delivered on ack', async () => {
    const live = new MockLiveSyncSource();
    const { wal, walStore } = makeWAL(live);
    const update = new Uint8Array([1, 2, 3]);

    walStore.pause();
    await wal.pushUpdate(update);

    expect(await walStore.count()).toBe(1); // written to the WAL
    expect(live.pushUpdate).not.toHaveBeenCalled(); // but wal store is paused

    walStore.resume();
    await wal.pendingFlush;

    expect(live.pushUpdate).toHaveBeenCalledExactlyOnceWith([update]);
    expect(await walStore.count()).toBe(1); // still there
    expect(await undeliveredCount(walStore)).toBe(0); // but marked delivered
  });

  it('keeps undelivered when live fails', async () => {
    const live = new MockLiveSyncSource();
    live.setPushResult(false);
    const { wal, walStore } = makeWAL(live);

    walStore.pause();
    await wal.pushUpdate(new Uint8Array([1, 2, 3]));
    walStore.resume();
    await wal.pendingFlush;

    expect(live.pushUpdate).toHaveBeenCalledOnce();
    expect(await undeliveredCount(walStore)).toBe(1);
  });

  it('batches all pending updates into a single live push', async () => {
    const live = new MockLiveSyncSource();
    const { wal, walStore } = makeWAL(live);

    walStore.pause();
    await wal.pushUpdate(new Uint8Array([1]));
    await wal.pushUpdate(new Uint8Array([2]));
    await wal.pushUpdate(new Uint8Array([3]));
    walStore.resume();
    await wal.pendingFlush;

    expect(live.pushUpdate).toHaveBeenCalledExactlyOnceWith([
      new Uint8Array([1]),
      new Uint8Array([2]),
      new Uint8Array([3]),
    ]);
    expect(await undeliveredCount(walStore)).toBe(0);
  });

  it('keeps all updates undelivered when the batch push fails', async () => {
    const live = new MockLiveSyncSource();
    live.setPushResult(false);
    const { wal, walStore } = makeWAL(live);

    walStore.pause();
    await wal.pushUpdate(new Uint8Array([1]));
    await wal.pushUpdate(new Uint8Array([2]));
    await wal.pushUpdate(new Uint8Array([3]));
    walStore.resume();
    await wal.pendingFlush;

    expect(live.pushUpdate).toHaveBeenCalledOnce();
    expect(await undeliveredCount(walStore)).toBe(3);
  });

  it('retries flush on reconnect', async () => {
    const live = new MockLiveSyncSource();
    live.setPushResult(false);
    const { wal, walStore } = makeWAL(live);

    walStore.pause();
    await wal.pushUpdate(new Uint8Array([1, 2, 3]));
    walStore.resume();
    await wal.pendingFlush;

    live.setPushResult(true);
    live.emit({
      type: 'reconnect',
      snapshot: new Uint8Array(),
      awareness: new Uint8Array(),
    });
    await wal.pendingFlush;

    expect(await undeliveredCount(walStore)).toBe(0);
  });

  it('flushes updates that arrived during an in-flight flush', async () => {
    const live = new MockLiveSyncSource();
    const { wal, walStore } = makeWAL(live);
    const { resolve } = live.holdNextPush();

    await wal.pushUpdate(new Uint8Array([1]));
    await vi.waitFor(() => expect(live.pushUpdate).toHaveBeenCalledOnce());

    live.setPushResult(true);
    await wal.pushUpdate(new Uint8Array([2]));

    resolve(true);
    await wal.pendingFlush;

    expect(live.pushUpdate).toHaveBeenCalledTimes(2);
    expect(await undeliveredCount(walStore)).toBe(0);
  });

  it('does not run concurrent flushes', async () => {
    const live = new MockLiveSyncSource();
    const { wal, walStore } = makeWAL(live);
    const { resolve } = live.holdNextPush();

    await wal.pushUpdate(new Uint8Array([1]));
    await wal.pushUpdate(new Uint8Array([2]));

    expect(live.pushUpdate).toHaveBeenCalledOnce();

    resolve(true);
    await wal.pendingFlush;

    expect(await undeliveredCount(walStore)).toBe(0);
  });

  it('does not re-push entries that are already delivered', async () => {
    const live = new MockLiveSyncSource();
    const { wal, walStore } = makeWAL(live);

    await wal.pushUpdate(new Uint8Array([1]));
    await wal.pendingFlush;
    expect(await undeliveredCount(walStore)).toBe(0);

    // Trigger flush when everything is already delivered — should be a no-op.
    const callsBefore = live.pushUpdate.mock.calls.length;
    expect(callsBefore).toBe(1); // pushed once during the first flush
    await wal.flush();
    expect(live.pushUpdate.mock.calls.length).toBe(callsBefore);
  });

  it('does not push when the WAL is empty', async () => {
    const live = new MockLiveSyncSource();
    const { wal } = makeWAL(live);

    await wal.flush();
    expect(live.pushUpdate).not.toHaveBeenCalled();
  });

  it('pruneDelivered drops delivered entries and keeps undelivered ones', async () => {
    const live = new MockLiveSyncSource();
    const { wal, walStore } = makeWAL(live);

    // First batch: succeeds -> entries 1 and 2 marked delivered.
    walStore.pause();
    await wal.pushUpdate(new Uint8Array([1]));
    await wal.pushUpdate(new Uint8Array([2]));
    walStore.resume();
    await wal.pendingFlush;

    // Second batch: fails -> entry 3 stays undelivered.
    live.setPushResult(false);
    await wal.pushUpdate(new Uint8Array([3]));
    await wal.pendingFlush;

    expect(await walStore.count()).toBe(3);
    expect(await undeliveredCount(walStore)).toBe(1);

    await wal.pruneDelivered();
    expect(await walStore.count()).toBe(1); // entry 3 survives
    expect(await undeliveredCount(walStore)).toBe(1);
  });

  it('pruneDelivered does not drop undelivered entries', async () => {
    const live = new MockLiveSyncSource();
    live.setPushResult(false);
    const { wal, walStore } = makeWAL(live);

    await wal.pushUpdate(new Uint8Array([1]));
    await wal.pendingFlush;

    expect(await undeliveredCount(walStore)).toBe(1);

    await wal.pruneDelivered();
    expect(await walStore.count()).toBe(1); // undelivered entry survives prune
  });
});
