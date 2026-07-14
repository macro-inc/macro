import { LoroDoc, type VersionVector } from 'loro-crdt';
import { okAsync } from 'neverthrow';
import { vi } from 'vitest';
import { type LiveSyncSource, SyncSourceStatus } from '../source';

/**
 * In-memory "sync service" for tests. Holds a real LoroDoc and answers
 * `requestUpdatesSince` with precise op deltas. Doubles as a LiveSyncSource
 * so it can be plugged into `createLoroManager` directly.
 */
export class TestServer {
  public readonly doc = new LoroDoc();

  constructor() {
    this.doc.setPeerId(99n);
  }

  /** Import bytes produced elsewhere (e.g. a client's exported update). */
  applyUpdate(update: Uint8Array): void {
    this.doc.import(update);
  }

  /** Current state as a shallow snapshot — what `RemoteInitialSync` would carry. */
  shallowSnapshot(): Uint8Array {
    return this.doc.export({
      mode: 'shallow-snapshot',
      frontiers: this.doc.oplogFrontiers(),
    });
  }

  /** Adapter: present as a LiveSyncSource so it can drive a LoroManager. */
  asLiveSyncSource(): LiveSyncSource {
    return {
      documentId: 'doc-1',
      listen: () => () => {},
      pushUpdate: vi.fn(async (updates: Uint8Array[]) => {
        for (const update of updates) this.doc.import(update);
        return true;
      }),
      pushAwareness: vi.fn(),
      registerPeerId: vi.fn(),
      reconnect: vi.fn(),
      cleanup: vi.fn(),
      requestSnapshot: vi.fn(() => okAsync(this.shallowSnapshot())),
      requestUpdatesSince: vi.fn((vv: VersionVector) =>
        // Version vector is lenient: peers it includes that we don't know
        // about are harmless (we just don't have ops for them).
        okAsync(this.doc.export({ mode: 'update', from: vv }))
      ),
      status: () => SyncSourceStatus.Connected,
    };
  }
}
