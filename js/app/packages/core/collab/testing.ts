import { ok, okAsync } from 'neverthrow';
import { vi } from 'vitest';
import type { LoroManager } from './manager';
import type { GenericRootSchema, LoroRawUpdate, RawUpdate } from './shared';
import type { SnapshotStore } from './snapshot-store';
import type { SyncSourceEvent, WALSyncSource } from './source';
import { type LiveSyncSource, SyncSourceStatus } from './source';
import type { WALEntry, WALStore } from './wal';

export class MockSnapshotStore implements SnapshotStore {
  private snapshot: RawUpdate | null = null;

  public async save(snapshot: RawUpdate): Promise<void> {
    this.snapshot = snapshot;
  }

  public async load(): Promise<RawUpdate | null> {
    return this.snapshot;
  }

  public async delete(): Promise<void> {
    this.snapshot = null;
  }
}

export class MockWALStore implements WALStore {
  private entries: WALEntry[] = [];
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

  public async append(update: RawUpdate): Promise<void> {
    this.entries.push({
      id: this.nextId++,
      update,
      delivered: false,
      createdAt: Date.now(),
    });
  }

  public async getAll(): Promise<WALEntry[]> {
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
    this.entries = this.entries.filter((e) => e.createdAt >= cutoff);
    return before - this.entries.length;
  }

  public async count(): Promise<number> {
    return this.entries.length;
  }

  public markClean(): void {}

  /** Test helper: seed an entry with an explicit createdAt timestamp. */
  public seedEntry(update: RawUpdate, createdAt: number): number {
    const id = this.nextId++;
    this.entries.push({ id, update, delivered: false, createdAt });
    return id;
  }
}

export class MockWALSyncSource implements WALSyncSource {
  private listeners = new Set<(event: SyncSourceEvent) => void>();

  public documentId = 'doc-1';
  public pushUpdate = vi.fn(async (): Promise<boolean> => true);
  public flush = vi.fn(async (): Promise<void> => {});
  public pruneDelivered = vi.fn(async (): Promise<void> => {});

  public listen(cb: (event: SyncSourceEvent) => void) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  public emit(event: SyncSourceEvent) {
    this.listeners.forEach((cb) => void cb(event));
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

export class MockLoroManager implements LoroManager<GenericRootSchema> {
  private updateCallbacks = new Set<(update: LoroRawUpdate) => void>();
  private _initialized: boolean;

  public schema = {} as GenericRootSchema;
  public state = vi.fn(() => undefined as any);
  public error = vi.fn(() => []);
  public isInitialized: () => boolean;
  public getPeerId = vi.fn(() => BigInt(1));
  public getPeerIdStr = vi.fn(() => '1' as any);
  public importUpdate = vi.fn(() => ok(true));
  public importBatchUpdates = vi.fn(() => ok(true));
  public syncToLoro = vi.fn(async () => ok(undefined as void));
  public reset = vi.fn(async () => ok(undefined as void));
  public initializeFromSnapshot = vi.fn(async () => ok(undefined as void));
  public ingest = vi.fn(async () => {});
  public getVersion = vi.fn(() => ({}) as any);
  public getUpdateSince = vi.fn(() => ok(undefined as any));
  public getAllContainerIds = vi.fn(() => ok([]));
  public getContainerById = vi.fn(() => ok(undefined as any));
  public getCursorPos = vi.fn(() => ok({ offset: 0, side: 0 as any }));
  public getMirror = vi.fn(() => undefined as any);

  constructor(initialized = true) {
    this._initialized = initialized;
    this.isInitialized = () => this._initialized;
  }

  public getDoc() {
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
