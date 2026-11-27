import { SyncSourceStatus } from '@macro-inc/collaboration/collab/source';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCollabSyncHealth } from './syncHealth';

class FakeWAL {
  private since: number | undefined;
  private readonly listeners = new Set<(since: number | undefined) => void>();
  readonly flush = vi.fn(async () => {});

  pendingSince() {
    return this.since;
  }

  onPendingChange(listener: (since: number | undefined) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  set(since: number | undefined) {
    this.since = since;
    for (const listener of this.listeners) listener(since);
  }
}

function setup() {
  const wal = new FakeWAL();
  const [status, setStatus] = createSignal(SyncSourceStatus.Connected);
  const [canEdit, setCanEdit] = createSignal(true);
  const resyncListeners = new Set<() => void>();
  const resync = () => {
    for (const listener of resyncListeners) listener();
  };
  const reconnect = vi.fn();
  return createRoot((dispose) => {
    const health = createCollabSyncHealth({
      status,
      onResync: (listener) => {
        resyncListeners.add(listener);
        return () => resyncListeners.delete(listener);
      },
      canEdit,
      wal,
      reconnect,
      delay: 10_000,
    });
    return { health, wal, setStatus, setCanEdit, resync, reconnect, dispose };
  });
}

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createCollabSyncHealth', () => {
  it('reports unsaved edits once the oldest has waited the delay, and clears when they are delivered', () => {
    const { health, wal, dispose } = setup();
    wal.set(Date.now());
    vi.advanceTimersByTime(9_999);
    expect(health.problem()).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(health.problem()).toBe('unsaved');

    wal.set(undefined);
    expect(health.problem()).toBeUndefined();
    dispose();
  });

  it('stays quiet while edits keep being delivered, even when new ones are always pending', () => {
    const { health, wal, dispose } = setup();
    for (let i = 0; i < 30; i++) {
      wal.set(Date.now());
      vi.advanceTimersByTime(1_000);
    }
    expect(health.problem()).toBeUndefined();
    dispose();
  });

  it('reports an edit that was already overdue when the session started watching', () => {
    const { health, wal, dispose } = setup();
    wal.set(Date.now() - 60_000);
    expect(health.problem()).toBe('unsaved');
    dispose();
  });

  it('reports a disconnect that lasts the delay and clears once the document has caught up', () => {
    const { health, setStatus, resync, dispose } = setup();
    setStatus(SyncSourceStatus.Connecting);
    vi.advanceTimersByTime(5_000);
    setStatus(SyncSourceStatus.Connected);
    resync();
    vi.advanceTimersByTime(10_000);
    expect(health.problem()).toBeUndefined();

    // Reconnect attempts flip between Connecting and Disconnected; the
    // outage still counts from when the link dropped.
    setStatus(SyncSourceStatus.Disconnected);
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(2_500);
      setStatus(
        i % 2 ? SyncSourceStatus.Disconnected : SyncSourceStatus.Connecting
      );
    }
    expect(health.problem()).toBe('offline');
    // The socket is back, but the document hasn't caught up yet.
    setStatus(SyncSourceStatus.Connected);
    vi.advanceTimersByTime(30_000);
    expect(health.problem()).toBe('offline');
    resync();
    expect(health.problem()).toBeUndefined();
    dispose();
  });

  it("doesn't tell a viewer who can't edit about edits they can't send", () => {
    const { health, wal, setCanEdit, dispose } = setup();
    setCanEdit(false);
    wal.set(Date.now() - 60_000);
    expect(health.problem()).toBeUndefined();
    setCanEdit(true);
    expect(health.problem()).toBe('unsaved');
    dispose();
  });

  it('prefers unsaved edits over a disconnect, and retry reconnects and resends', () => {
    const { health, wal, setStatus, reconnect, dispose } = setup();
    setStatus(SyncSourceStatus.Disconnected);
    wal.set(Date.now());
    vi.advanceTimersByTime(10_000);
    expect(health.problem()).toBe('unsaved');

    health.retry();
    expect(reconnect).toHaveBeenCalledOnce();
    expect(wal.flush).toHaveBeenCalledOnce();
    dispose();
  });
});
