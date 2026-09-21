import { noopChatter } from '@macro-inc/collaboration/collab/chatter';
import type { SnapshotStore } from '@macro-inc/collaboration/collab/snapshot-store';
import {
  createNoopLiveSyncSource,
  type LiveSyncSource,
  type SyncSourceEvent,
} from '@macro-inc/collaboration/collab/source';
import { InMemoryWALStore } from '@macro-inc/collaboration/collab/wal';
import { LoroDoc } from 'loro-crdt';
import { errAsync, okAsync } from 'neverthrow';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import {
  readSpreadsheetCells,
  writeSpreadsheetCells,
} from '../core/spreadsheet-document';
import { createSpreadsheetStore } from '../primitives/create-spreadsheet-store';
import { createSpreadsheetSession } from './spreadsheet-session';

function memoryPersistence(snapshot: Uint8Array | null = null) {
  let cached = snapshot;
  const snapshots: SnapshotStore<Uint8Array> = {
    save: async (value) => {
      cached = value;
    },
    load: async () => cached,
    delete: async () => {
      cached = null;
    },
  };
  return {
    snapshots,
    wal: new InMemoryWALStore<Uint8Array>(),
    makeChatter: noopChatter,
  };
}

function fakeLiveSource() {
  const listeners = new Set<(event: SyncSourceEvent) => void>();
  const live: LiveSyncSource = {
    ...createNoopLiveSyncSource(crypto.randomUUID()),
    listen: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    cleanup: () => listeners.clear(),
  };
  return {
    live,
    emit: (event: SyncSourceEvent) => {
      for (const listener of listeners) listener(event);
    },
  };
}

describe('spreadsheet session', () => {
  it('reopens from the WAL without writing a stale teardown snapshot', async () => {
    const remote = new LoroDoc();
    writeSpreadsheetCells(remote, { A1: { value: 'base' } });
    const persistence = memoryPersistence();
    const save = vi.spyOn(persistence.snapshots, 'save');
    const firstTransport = fakeLiveSource();
    let closeFirst = () => {};
    const first = createRoot((dispose) => {
      closeFirst = dispose;
      return createSpreadsheetSession(
        {
          documentId: firstTransport.live.documentId,
          canEdit: () => true,
          syncSource: firstTransport.live,
          doInitialSync: () =>
            okAsync({
              snapshot: remote.export({ mode: 'snapshot' }),
              awareness: new Uint8Array(),
            }),
        },
        persistence
      );
    });
    await vi.waitFor(() => expect(first.ready()).toBe(true));
    writeSpreadsheetCells(first.doc()!, { B1: { value: 'unsent local edit' } });
    await vi.waitFor(async () =>
      expect(await persistence.wal.getAll()).toHaveLength(1)
    );
    closeFirst();
    const secondTransport = fakeLiveSource();
    let closeSecond = () => {};
    const second = createRoot((dispose) => {
      closeSecond = dispose;
      return createSpreadsheetSession(
        {
          documentId: firstTransport.live.documentId,
          canEdit: () => true,
          syncSource: secondTransport.live,
          doInitialSync: () => errAsync({ type: 'timeout', duration: 10_000 }),
        },
        persistence
      );
    });
    await vi.waitFor(() => expect(second.ready()).toBe(true));
    expect(readSpreadsheetCells(second.doc()!).B1.value).toBe(
      'unsent local edit'
    );
    expect(save).toHaveBeenCalledTimes(2); // Only each session's recovery base.
    closeSecond();
    remote.free();
  });

  it('waits for an in-flight snapshot before a replacement session loads its cache', async () => {
    const remote = new LoroDoc();
    writeSpreadsheetCells(remote, { A1: { value: 'base' } });
    const persistence = memoryPersistence();
    const originalSave = persistence.snapshots.save;
    let finishWrite = () => {};
    const save = vi.spyOn(persistence.snapshots, 'save').mockImplementationOnce(
      (snapshot) =>
        new Promise<void>((resolve) => {
          finishWrite = () => {
            void originalSave(snapshot).then(resolve);
          };
        })
    );
    const load = vi.spyOn(persistence.snapshots, 'load');
    const transport = fakeLiveSource();
    let closeFirst = () => {};
    const first = createRoot((dispose) => {
      closeFirst = dispose;
      return createSpreadsheetSession(
        {
          documentId: transport.live.documentId,
          canEdit: () => true,
          syncSource: transport.live,
          doInitialSync: () =>
            okAsync({
              snapshot: remote.export({ mode: 'snapshot' }),
              awareness: new Uint8Array(),
            }),
        },
        persistence
      );
    });
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    closeFirst();
    let closeSecond = () => {};
    const second = createRoot((dispose) => {
      closeSecond = dispose;
      return createSpreadsheetSession(
        {
          documentId: transport.live.documentId,
          canEdit: () => true,
          syncSource: fakeLiveSource().live,
          doInitialSync: () => errAsync({ type: 'timeout', duration: 10_000 }),
        },
        persistence
      );
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(load).toHaveBeenCalledOnce();
    expect(second.ready()).toBe(false);
    finishWrite();
    await vi.waitFor(() => expect(second.ready()).toBe(true));
    expect(first.ready()).toBe(false);
    expect(readSpreadsheetCells(second.doc()!).A1.value).toBe('base');
    expect(save).toHaveBeenCalledTimes(2);
    closeSecond();
    remote.free();
  });

  it('does not accept edits when the initial recovery snapshot cannot be saved', async () => {
    const remote = new LoroDoc();
    const transport = fakeLiveSource();
    const persistence = memoryPersistence();
    persistence.snapshots.save = async () => {
      throw new Error('Storage full');
    };
    let dispose = () => {};
    const session = createRoot((cleanup) => {
      dispose = cleanup;
      return createSpreadsheetSession(
        {
          documentId: transport.live.documentId,
          canEdit: () => true,
          syncSource: transport.live,
          doInitialSync: () =>
            okAsync({
              snapshot: remote.export({ mode: 'snapshot' }),
              awareness: new Uint8Array(),
            }),
        },
        persistence
      );
    });
    await vi.waitFor(() => expect(session.error()).toContain('Local storage'));
    expect(session.ready()).toBe(false);
    expect(session.doc()).toBeUndefined();
    dispose();
    remote.free();
  });

  it('leaves an unsupported future format unopened', async () => {
    const remote = new LoroDoc();
    remote.getMap('spreadsheetMeta').set('formatVersion', 2);
    remote.commit();
    const transport = fakeLiveSource();
    let dispose = () => {};
    const session = createRoot((cleanup) => {
      dispose = cleanup;
      return createSpreadsheetSession(
        {
          documentId: transport.live.documentId,
          canEdit: () => true,
          syncSource: transport.live,
          doInitialSync: () =>
            okAsync({
              snapshot: remote.export({ mode: 'snapshot' }),
              awareness: new Uint8Array(),
            }),
        },
        memoryPersistence()
      );
    });
    await vi.waitFor(() => expect(session.error()).toContain('newer format'));
    expect(session.ready()).toBe(false);
    dispose();
    remote.free();
  });

  it('does not restart a session closed during hydration', async () => {
    const remote = new LoroDoc();
    const transport = fakeLiveSource();
    const cleanupTransport = vi.spyOn(transport.live, 'cleanup');
    const persistence = memoryPersistence();
    let finishLoad: (value: Uint8Array | null) => void = () => {};
    persistence.snapshots.load = () =>
      new Promise((resolve) => {
        finishLoad = resolve;
      });
    let dispose = () => {};
    const session = createRoot((cleanup) => {
      dispose = cleanup;
      return createSpreadsheetSession(
        {
          documentId: transport.live.documentId,
          canEdit: () => true,
          syncSource: transport.live,
          doInitialSync: () =>
            okAsync({
              snapshot: remote.export({ mode: 'snapshot' }),
              awareness: new Uint8Array(),
            }),
        },
        persistence
      );
    });
    dispose();
    finishLoad(null);
    await Promise.resolve();
    await Promise.resolve();
    expect(session.ready()).toBe(false);
    expect(session.doc()).toBeUndefined();
    expect(cleanupTransport).toHaveBeenCalledOnce();
    remote.free();
  });

  it('hydrates before accepting edits and applies incoming live updates', async () => {
    const remote = new LoroDoc();
    writeSpreadsheetCells(remote, { A1: { value: 'server' } });
    const transport = fakeLiveSource();
    const persistence = memoryPersistence();
    let dispose = () => {};
    const { session, store } = createRoot((cleanup) => {
      dispose = cleanup;
      const session = createSpreadsheetSession(
        {
          documentId: transport.live.documentId,
          canEdit: () => true,
          syncSource: transport.live,
          doInitialSync: () =>
            okAsync({
              snapshot: remote.export({ mode: 'snapshot' }),
              awareness: new Uint8Array(),
            }),
        },
        persistence
      );
      return {
        session,
        store: createSpreadsheetStore({ source: session, canEdit: () => true }),
      };
    });
    store.setCells({ A1: { value: 'too early' } });
    await vi.waitFor(() => expect(session.ready()).toBe(true));
    expect(store.cells().A1.value).toBe('server');
    expect(store.canUndo()).toBe(false);
    expect(await persistence.snapshots.load()).not.toBeNull();
    writeSpreadsheetCells(remote, { B2: { value: '=A1' } });
    transport.emit({
      type: 'update',
      update: remote.export({ mode: 'update' }),
    });
    await vi.waitFor(() => expect(store.cells().B2?.value).toBe('=A1'));
    dispose();
    remote.free();
  });

  it('rebinds the editor after sync recovery replaces the Loro document', async () => {
    const remote = new LoroDoc();
    writeSpreadsheetCells(remote, { A1: { value: 'initial' } });
    const transport = fakeLiveSource();
    transport.live.requestSnapshot = () =>
      okAsync(remote.export({ mode: 'snapshot' }));
    let dispose = () => {};
    const { session, store } = createRoot((cleanup) => {
      dispose = cleanup;
      const session = createSpreadsheetSession(
        {
          documentId: transport.live.documentId,
          canEdit: () => true,
          syncSource: transport.live,
          doInitialSync: () =>
            okAsync({
              snapshot: remote.export({ mode: 'snapshot' }),
              awareness: new Uint8Array(),
            }),
        },
        memoryPersistence()
      );
      return {
        session,
        store: createSpreadsheetStore({ source: session, canEdit: () => true }),
      };
    });
    await vi.waitFor(() => expect(session.ready()).toBe(true));
    const previousDocument = session.doc();
    writeSpreadsheetCells(remote, { A1: { value: 'recovered' } });
    transport.emit({ type: 'update', update: new Uint8Array([1, 2, 3]) });
    await vi.waitFor(() => expect(session.doc()).not.toBe(previousDocument));
    expect(store.cells().A1.value).toBe('recovered');
    store.setCells({ B1: { value: 'still editable' } });
    expect(store.cells().B1.value).toBe('still editable');
    dispose();
    remote.free();
  });

  it('recovers cached cells and pending WAL edits before an offline load', async () => {
    const local = new LoroDoc();
    writeSpreadsheetCells(local, { A1: { value: 'cached' } });
    const persistence = memoryPersistence(local.export({ mode: 'snapshot' }));
    const version = local.version();
    writeSpreadsheetCells(local, { B1: { value: 'pending offline edit' } });
    await persistence.wal.append(
      local.export({ mode: 'update', from: version })
    );
    const transport = fakeLiveSource();
    let dispose = () => {};
    const session = createRoot((cleanup) => {
      dispose = cleanup;
      return createSpreadsheetSession(
        {
          documentId: transport.live.documentId,
          canEdit: () => true,
          syncSource: transport.live,
          doInitialSync: () => errAsync({ type: 'timeout', duration: 10_000 }),
        },
        persistence
      );
    });
    await vi.waitFor(() => expect(session.ready()).toBe(true));
    expect(readSpreadsheetCells(session.doc()!)).toEqual({
      A1: { value: 'cached' },
      B1: { value: 'pending offline edit' },
    });
    await vi.waitFor(() => expect(session.error()).toContain('Reconnecting'));
    transport.emit({
      type: 'reconnect',
      snapshot: local.export({ mode: 'snapshot' }),
      awareness: new Uint8Array(),
    });
    await vi.waitFor(() => expect(session.error()).toBeUndefined());
    dispose();
    local.free();
  });

  it('opens on reconnect after the first network attempt failed without a cache', async () => {
    const remote = new LoroDoc();
    writeSpreadsheetCells(remote, { A1: { value: 'recovered' } });
    const transport = fakeLiveSource();
    let dispose = () => {};
    const session = createRoot((cleanup) => {
      dispose = cleanup;
      return createSpreadsheetSession(
        {
          documentId: transport.live.documentId,
          canEdit: () => true,
          syncSource: transport.live,
          doInitialSync: () => errAsync({ type: 'timeout', duration: 10_000 }),
        },
        memoryPersistence()
      );
    });
    await vi.waitFor(() => expect(session.error()).toBeDefined());
    expect(session.ready()).toBe(false);
    transport.emit({
      type: 'connect',
      snapshot: remote.export({ mode: 'snapshot' }),
      awareness: new Uint8Array(),
    });
    await vi.waitFor(() => expect(session.ready()).toBe(true));
    expect(readSpreadsheetCells(session.doc()!).A1.value).toBe('recovered');
    expect(session.error()).toBeUndefined();
    dispose();
    remote.free();
  });
});
