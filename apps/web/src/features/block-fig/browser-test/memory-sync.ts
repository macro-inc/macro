/**
 * An in-page stand-in for the sync service: one Loro document and one
 * awareness store, relaying each person's updates to the others after a
 * short delay (as a network would). People connect through the same
 * `LiveSyncSource` contract the real transport implements, so the design
 * session, its WAL, and awareness run as they do in the app.
 */

import {
  type LiveSyncSource,
  type SyncSourceEvent,
  SyncSourceStatus,
} from '@macro-inc/collaboration/collab/source';
import { EphemeralStore, LoroDoc, type VersionVector } from 'loro-crdt';
import { okAsync } from 'neverthrow';
import type { DesignConnection } from '../queries/fig-collab';

/** Delivery delay between people, in milliseconds. */
const LATENCY_MS = 20;

export class MemorySyncServer {
  readonly doc = new LoroDoc();
  private readonly awareness = new EphemeralStore(10_000);
  private readonly clients = new Set<(event: SyncSourceEvent) => void>();
  private initialized = false;
  private file = new Uint8Array();
  /** While `false`, people opening the design cannot reach the server. */
  reachable = true;

  constructor() {
    this.doc.setPeerId(99n);
  }

  /** The stored `.fig` (document storage, which people open), a copy. */
  stored(): ArrayBuffer {
    return this.file.slice().buffer;
  }

  store(bytes: Uint8Array): void {
    this.file = bytes.slice();
  }

  private ensureReachable() {
    if (!this.reachable) throw new Error('The sync service is unreachable.');
  }

  async exists(): Promise<boolean> {
    this.ensureReachable();
    return this.initialized;
  }

  async initialize(snapshot: Uint8Array): Promise<void> {
    this.ensureReachable();
    if (this.initialized) throw new Error('already initialized');
    this.doc.import(snapshot);
    this.initialized = true;
  }

  private relay(
    from: (event: SyncSourceEvent) => void,
    event: SyncSourceEvent
  ) {
    setTimeout(() => {
      for (const client of this.clients) if (client !== from) client(event);
    }, LATENCY_MS);
  }

  /** A person's connection. */
  connect(documentId: string): DesignConnection {
    const listeners = new Set<(event: SyncSourceEvent) => void>();
    const deliver = (event: SyncSourceEvent) => {
      for (const listener of listeners) listener(event);
    };
    this.clients.add(deliver);
    const snapshot = () => this.doc.export({ mode: 'snapshot' });
    const source: LiveSyncSource = {
      documentId,
      status: () => SyncSourceStatus.Connected,
      listen: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      pushUpdate: async (updates) => {
        for (const update of updates) {
          this.doc.import(update);
          this.relay(deliver, { type: 'update', update });
        }
        return true;
      },
      pushAwareness: (value) => {
        this.awareness.apply(value);
        this.relay(deliver, { type: 'awareness', awareness: value });
      },
      registerPeerId: () => {},
      requestUpdatesSince: (version: VersionVector) =>
        okAsync(this.doc.export({ mode: 'update', from: version })),
      requestSnapshot: () => okAsync(snapshot()),
      reconnect: () => {},
      cleanup: () => {
        this.clients.delete(deliver);
      },
    };
    return {
      source,
      doInitialSync: () =>
        okAsync({
          snapshot: snapshot(),
          awareness: this.awareness.encodeAll(),
        }),
    };
  }
}
