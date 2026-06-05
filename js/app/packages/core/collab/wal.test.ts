import { describe, expect, it, vi } from 'vitest';
import { MockLiveSyncSource, MockWALStore } from './testing';
import { IDBWALSyncSource } from './wal';

function makeWAL(live: MockLiveSyncSource) {
  const walStore = new MockWALStore();
  const wal = new IDBWALSyncSource(live, walStore);
  return { wal, walStore };
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

describe('IDBWALSyncSource', () => {
  it('persists before delivering, then clears on ack', async () => {
    const live = new MockLiveSyncSource();
    const { wal, walStore } = makeWAL(live);
    const update = new Uint8Array([1, 2, 3]);

    walStore.pause();
    await wal.pushUpdate(update);

    expect(await walStore.count()).toBe(1); // it was written to the WAL
    expect(live.pushUpdate).not.toHaveBeenCalled(); // but wal store is paused rn

    walStore.resume();
    await wal.pendingFlush;

    expect(live.pushUpdate).toHaveBeenCalledExactlyOnceWith([update]);
    expect(await walStore.count()).toBe(0); // and we popped updates after they were safely flushed
  });

  it('retains update in store when live fails', async () => {
    const live = new MockLiveSyncSource();
    live.setPushResult(false); // next push update will fail
    const { wal, walStore } = makeWAL(live);

    walStore.pause();
    await wal.pushUpdate(new Uint8Array([1, 2, 3]));
    walStore.resume();
    await wal.pendingFlush;

    expect(live.pushUpdate).toHaveBeenCalledTimes(1);
    expect(await walStore.count()).toBe(1); // we couldn't pop it, since we failed to flush
    // this is probably stupid, but maybe we messed up and it drains later? idk just to be safe
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await walStore.count()).toBe(1); // we couldn't pop it, since we failed to flush
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
    expect(await walStore.count()).toBe(0); // all delivered, store cleared
  });

  it('retains all updates when the batch push fails', async () => {
    const live = new MockLiveSyncSource();
    live.setPushResult(false);
    const { wal, walStore } = makeWAL(live);

    walStore.pause();
    await wal.pushUpdate(new Uint8Array([1]));
    await wal.pushUpdate(new Uint8Array([2]));
    await wal.pushUpdate(new Uint8Array([3]));
    walStore.resume();
    await wal.pendingFlush;

    expect(live.pushUpdate).toHaveBeenCalledTimes(1);
    expect(await walStore.count()).toBe(3); // batch failed, all retained
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

    expect(await walStore.count()).toBe(0);
  });

  it('flushes updates that arrived during an in-flight flush', async () => {
    const live = new MockLiveSyncSource();
    const { wal, walStore } = makeWAL(live);
    const { resolve } = live.holdNextPush();

    await wal.pushUpdate(new Uint8Array([1]));
    await vi.waitFor(() => expect(live.pushUpdate).toHaveBeenCalledTimes(1));

    live.setPushResult(true);
    await wal.pushUpdate(new Uint8Array([2]));

    resolve(true);
    await wal.pendingFlush;

    expect(live.pushUpdate).toHaveBeenCalledTimes(2);
    expect(await walStore.count()).toBe(0);
  });

  it('does not run concurrent flushes', async () => {
    const live = new MockLiveSyncSource();
    const { wal, walStore } = makeWAL(live);
    const { resolve } = live.holdNextPush();

    await wal.pushUpdate(new Uint8Array([1]));
    await wal.pushUpdate(new Uint8Array([2]));

    expect(live.pushUpdate).toHaveBeenCalledTimes(1);

    resolve(true);
    await wal.pendingFlush;

    expect(await walStore.count()).toBe(0);
  });
});
