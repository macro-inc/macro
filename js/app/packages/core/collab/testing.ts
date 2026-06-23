import { ok, okAsync } from 'neverthrow';
import { vi } from 'vitest';
import type { Chatter, ChatterMessage } from './chatter';
import type { SyncEngineManager } from './manager';
import type { GenericRootSchema, LoroRawUpdate, RawUpdate } from './shared';
import type { SnapshotStore } from './snapshot-store';
import type { SyncSourceEvent } from './source';
import { type LiveSyncSource, SyncSourceStatus } from './source';
import { hasExpired, type WALEntry, type WALStore, WALSyncer } from './wal';

export class MockSnapshotStore<T> implements SnapshotStore<T> {
  private snapshot: T | null = null;

  public async save(snapshot: T): Promise<void> {
    this.snapshot = snapshot;
  }

  public async load(): Promise<T | null> {
    return this.snapshot;
  }

  public async delete(): Promise<void> {
    this.snapshot = null;
  }
}

export class MockWALStore<T> implements WALStore<T> {
  private entries: WALEntry<T>[] = [];
  private nextId = 0;
  private gate: Promise<void> = Promise.resolve();
  private openGate: () => void = () => {};

  public pause() {
    this.gate = new Promise((r) => (this.openGate = r));
  }

  public resume() {
    this.openGate();
    this.gate = Promise.resolve();
  }

  public async append(update: T): Promise<void> {
    this.entries.push({
      id: this.nextId++,
      update,
      delivered: false,
      createdAt: Date.now(),
    });
  }

  public async getAll(): Promise<WALEntry<T>[]> {
    await this.gate;
    return this.entries.map((e) => ({ ...e }));
  }

  public async markDelivered(ids: number[]): Promise<void> {
    const set = new Set(ids);
    this.entries = this.entries.map((e) =>
      set.has(e.id) ? { ...e, delivered: true } : e
    );
  }

  public async pruneDelivered(): Promise<void> {
    this.entries = this.entries.filter((e) => !e.delivered);
  }

  public async pruneExpired(ttlMs: number): Promise<number> {
    const cutoff = Date.now() - ttlMs;
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => !hasExpired(e, cutoff));
    return before - this.entries.length;
  }

  public async count(): Promise<number> {
    return this.entries.length;
  }

  /** Test helper: seed an entry with an explicit createdAt timestamp. */
  public seedEntry(update: T, createdAt: number, delivered = false): number {
    const id = this.nextId++;
    this.entries.push({ id, update, delivered, createdAt });
    return id;
  }
}

/** Build a real WALSyncer wired to a MockLiveSyncSource, with reconnect →
 *  flush wired up (which `createWALSyncSource` does for production callers). */
export function makeTestWAL(
  live: MockLiveSyncSource,
  store: MockWALStore<RawUpdate> = new MockWALStore<RawUpdate>()
): { wal: WALSyncer<RawUpdate>; walStore: MockWALStore<RawUpdate> } {
  const wal = new WALSyncer<RawUpdate>(store, (updates) =>
    live.pushUpdate(updates)
  );
  live.listen((event) => {
    if (event.type === 'reconnect') void wal.flush();
  });
  return { wal, walStore: store };
}

/**
 * In-memory {@link Chatter} for tests — no real BroadcastChannel, so the engine
 * tests don't depend on an ambient browser global. Records what the engine
 * broadcasts (`posted`) and lets a test inject inbound messages (`receive`).
 */
export class MockChatter implements Chatter {
  public posted: ChatterMessage[] = [];
  public closed = false;
  private handlers = new Set<(message: ChatterMessage) => void>();

  public post = vi.fn((message: ChatterMessage) => {
    this.posted.push(message);
  });

  public subscribe(handler: (message: ChatterMessage) => void) {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  public close() {
    this.closed = true;
    this.handlers.clear();
  }

  /** Test helper: simulate a message arriving from another replica. */
  public receive(message: ChatterMessage) {
    this.handlers.forEach((h) => h(message));
  }
}

export class MockLiveSyncSource implements LiveSyncSource {
  private listeners = new Set<(event: SyncSourceEvent) => void>();
  private pushResult = true;
  private pushResultQueue: boolean[] = [];
  private deferredPushes: Promise<boolean>[] = [];

  public documentId = 'doc-1';
  public pushUpdate = vi.fn(async (_updates: RawUpdate[]): Promise<boolean> => {
    if (this.deferredPushes.length > 0) return this.deferredPushes.shift()!;
    if (this.pushResultQueue.length > 0) return this.pushResultQueue.shift()!;
    return this.pushResult;
  });

  public holdNextPush(): { resolve: (v: boolean) => void } {
    const { promise, resolve } = Promise.withResolvers<boolean>();
    this.deferredPushes.push(promise);
    return { resolve };
  }
  public pushAwareness = vi.fn();
  public registerPeerId = vi.fn();
  public reconnect = vi.fn();
  public cleanup = vi.fn();
  public requestSnapshot = vi.fn(() => okAsync(new Uint8Array()));
  public requestUpdatesSince = vi.fn(() => okAsync(new Uint8Array()));
  public status = vi.fn(() => SyncSourceStatus.Connected);

  public setPushResult(result: boolean) {
    this.pushResult = result;
    this.pushResultQueue = [];
  }

  public setPushResults(...results: boolean[]) {
    this.pushResultQueue = results;
  }

  public listen(cb: (event: SyncSourceEvent) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  public emit(event: SyncSourceEvent) {
    this.listeners.forEach((cb) => void cb(event));
  }
}

export class MockLoroManager implements SyncEngineManager<GenericRootSchema> {
  private updateCallbacks = new Set<(update: LoroRawUpdate) => void>();
  private _initialized: boolean;

  public peerId = BigInt(1);
  public importUpdate = vi.fn(() => ok(true));
  public syncToLoro = vi.fn(async () => ok(undefined as void));
  public reset = vi.fn(async () => ok(undefined as void));

  constructor(initialized = true) {
    this._initialized = initialized;
  }

  public get initialized(): boolean {
    return this._initialized;
  }

  public get doc() {
    return {
      subscribeLocalUpdates: (cb: (update: LoroRawUpdate) => void) => {
        this.updateCallbacks.add(cb);
        return () => this.updateCallbacks.delete(cb);
      },
      frontiers: vi.fn(() => []),
      version: vi.fn(() => ({ compare: () => 0 })),
    } as any;
  }

  public triggerLocalUpdate(update: LoroRawUpdate) {
    this.updateCallbacks.forEach((cb) => void cb(update));
  }
}
