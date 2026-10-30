import { noopChatter } from '@macro-inc/collaboration/collab/chatter';
import type { SnapshotStore } from '@macro-inc/collaboration/collab/snapshot-store';
import {
  createNoopLiveSyncSource,
  type SyncSourceEvent,
  SyncSourceStatus,
} from '@macro-inc/collaboration/collab/source';
import { InMemoryWALStore } from '@macro-inc/collaboration/collab/wal';
import {
  createGraphicsEditorFromBackend,
  translation,
  worldMatrix,
} from '@macro-inc/graphics';
import { createLoroGraphicsBackendFromDoc } from '@macro-inc/graphics/loro';
import { LoroDoc } from 'loro-crdt';
import { errAsync, okAsync } from 'neverthrow';
import { createEffect, createRoot, createSignal, on } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createCanvasSeed, readSharedCanvas } from '../core/collaboration';
import { createCanvasNextScene } from '../core/seed-scene';
import {
  type CanvasSession,
  type CanvasSessionOptions,
  createCanvasSession,
} from './canvas-session';

const initial = { version: 2, document: createCanvasNextScene() } as const;
const disposers: (() => void)[] = [];
afterEach(() => {
  disposers
    .splice(0)
    .reverse()
    .forEach((dispose) => dispose());
});

function persistence() {
  let stored: Uint8Array | null = null;
  const snapshots: SnapshotStore<Uint8Array> = {
    load: async () => stored,
    save: async (value) => {
      stored = value;
    },
    delete: async () => {
      stored = null;
    },
  };
  return {
    snapshots,
    wal: new InMemoryWALStore<Uint8Array>(),
    makeChatter: noopChatter,
  };
}
function ready(session: CanvasSession): Promise<LoroDoc> {
  return new Promise((resolve, reject) =>
    createRoot((dispose) => {
      disposers.push(dispose);
      createEffect(
        on(session.state, (state) => {
          if (state.t === 'ready') {
            dispose();
            resolve(state.doc);
          } else if (state.t === 'error') {
            dispose();
            reject(new Error(state.message));
          }
        })
      );
    })
  );
}
function open(
  options: Partial<CanvasSessionOptions> & Pick<CanvasSessionOptions, 'connect'>
) {
  return createRoot((dispose) => {
    disposers.push(dispose);
    const session = createCanvasSession({
      documentId: 'canvas-1',
      initial,
      canEdit: () => true,
      exists: async () => true,
      initialize: async () => {},
      persistence: persistence(),
      ...options,
    });
    return { ...session, close: dispose };
  });
}
function room() {
  const server = new LoroDoc();
  server.import(createCanvasSeed(initial, 'canvas-1'));
  disposers.push(() => server.free());
  const clients = new Set<(event: SyncSourceEvent) => void>();
  const [online, setOnline] = createSignal(true);
  const connect = () => {
    const listeners = new Set<(event: SyncSourceEvent) => void>();
    const emit = (event: SyncSourceEvent) => {
      for (const listener of listeners) listener(event);
    };
    clients.add(emit);
    return {
      source: {
        ...createNoopLiveSyncSource('canvas-1'),
        status: () =>
          online() ? SyncSourceStatus.Connected : SyncSourceStatus.Disconnected,
        listen: (listener: (event: SyncSourceEvent) => void) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
        pushUpdate: async (updates: Uint8Array[]) => {
          if (!online()) return false;
          for (const update of updates) {
            server.import(update);
            for (const client of clients)
              if (client !== emit) client({ type: 'update', update });
          }
          return true;
        },
        requestUpdatesSince: (from: import('loro-crdt').VersionVector) =>
          okAsync(server.export({ mode: 'update', from })),
        requestSnapshot: () => okAsync(server.export({ mode: 'snapshot' })),
        pushAwareness: (awareness: Uint8Array) => {
          if (online())
            for (const client of clients)
              if (client !== emit) client({ type: 'awareness', awareness });
        },
        cleanup: () => {
          clients.delete(emit);
        },
      },
      doInitialSync: () =>
        online()
          ? okAsync({
              snapshot: server.export({ mode: 'snapshot' }),
              awareness: new Uint8Array(),
            })
          : errAsync({ type: 'connection_failed' } as const),
    };
  };
  const reconnect = () => {
    setOnline(true);
    const initial = {
      snapshot: server.export({ mode: 'snapshot' }),
      awareness: new Uint8Array(),
    };
    for (const client of clients) client({ type: 'reconnect', ...initial });
  };
  return {
    server,
    connect,
    setOnline,
    reconnect,
    emit: (event: SyncSourceEvent) => {
      for (const client of clients) client(event);
    },
  };
}
function editor(doc: LoroDoc, canEdit = () => true) {
  const backend = createLoroGraphicsBackendFromDoc(
    doc,
    initial.document.rootId,
    canEdit
  );
  const editor = createGraphicsEditorFromBackend(backend);
  disposers.push(backend.dispose, editor.dispose);
  return editor;
}

it('three durable sessions merge independent edits and undo only local history', async () => {
  const server = room();
  const sessions = [open(server), open(server), open(server)];
  const docs = await Promise.all(sessions.map(ready));
  const editors = docs.map((doc) => editor(doc));
  const id = 'welcome-rectangle';
  editors[0]!.select(id);
  editors[0]!.beginTransform(id, { x: 0, y: 0 });
  editors[0]!.updateTransform({ x: 40, y: 0 });
  editors[0]!.commitTransform();
  editors[1]!.select(id);
  editors[1]!.setSelectionAppearance({ fill: 'red' });
  editors[2]!.select(id);
  editors[2]!.setSelectionAppearance({ stroke: 'blue' });
  await Promise.all(sessions.map((session) => session.flush()));
  // A real remote document event settles after the engine's import mutex.
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  for (const e of editors) {
    expect(e.document).toEqual(editors[0]!.document);
    expect(worldMatrix(e.document, id)[4]).toBe(140);
    expect(e.document.items[id]).toMatchObject({
      appearance: { fill: 'red', stroke: 'blue' },
    });
  }
  editors[0]!.undo();
  await sessions[0]!.flush();
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  expect(editors[1]!.document.items[id]).toMatchObject({
    transform: translation(100, 100),
    appearance: { fill: 'red' },
  });
});

it('recovers undelivered local edits on reload and delivers them after reconnect', async () => {
  const server = room();
  const stored = persistence();
  const session = open({ ...server, persistence: stored });
  const local = editor(await ready(session));
  server.setOnline(false);
  local.select('welcome-rectangle');
  local.setSelectionAppearance({ fill: 'orange' });
  expect(await session.flush()).toBe(false);
  expect((await stored.wal.getAll()).length).toBeGreaterThan(0);
  const reopened = open({ ...server, persistence: stored });
  const recovered = await ready(reopened);
  expect(
    readSharedCanvas(recovered).document.items['welcome-rectangle']
  ).toMatchObject({ appearance: { fill: 'orange' } });
  server.reconnect();
  await reopened.flush();
  expect(
    readSharedCanvas(server.server).document.items['welcome-rectangle']
  ).toMatchObject({ appearance: { fill: 'orange' } });
});

it('uses the winning server seed when another initializer wins', async () => {
  const server = room();
  const initialize = vi.fn(async () => {
    throw new Error('conflict');
  });
  let calls = 0;
  const session = open({
    ...server,
    exists: async () => ++calls > 1,
    initialize,
  });
  await ready(session);
  expect(initialize).toHaveBeenCalledOnce();
  expect(readSharedCanvas(await ready(session))).toEqual(
    readSharedCanvas(server.server)
  );
});

it('read-only sessions cannot seed a canvas or commit scene edits', async () => {
  const server = room();
  const initialize = vi.fn(async () => {});
  const session = open({ ...server, canEdit: () => false, initialize });
  const shared = await ready(session);
  const view = editor(shared, () => false);
  const before = shared.export({ mode: 'snapshot' });
  view.select('welcome-rectangle');
  view.setSelectionAppearance({ fill: 'pink' });
  expect(shared.export({ mode: 'snapshot' })).toEqual(before);
  expect(initialize).not.toHaveBeenCalled();
});

it('retries failed local WAL appends without replacing or losing the live scene', async () => {
  const server = room();
  const stored = persistence();
  const session = open({ ...server, persistence: stored });
  const doc = await ready(session);
  const local = editor(doc);
  const append = vi
    .spyOn(stored.wal, 'append')
    .mockRejectedValue(new Error('Disk unavailable'));
  local.select('welcome-rectangle');
  local.setSelectionAppearance({ fill: 'purple' });
  expect(await session.flush()).toBe(false);
  expect(session.failure()).toBeDefined();
  expect(
    readSharedCanvas(doc).document.items['welcome-rectangle']
  ).toMatchObject({ appearance: { fill: 'purple' } });
  append.mockRestore();
  expect(await session.retrySave()).toBe(true);
  expect(session.failure()).toBeUndefined();
  expect(
    readSharedCanvas(server.server).document.items['welcome-rectangle']
  ).toMatchObject({ appearance: { fill: 'purple' } });
  const current = session.state();
  expect(current.t === 'ready' ? current.doc : undefined).toBe(doc);
});

it('replays undelivered edits before exposing a replacement document after sync recovery', async () => {
  const server = room();
  const session = open(server);
  const original = await ready(session);
  const local = editor(original);
  server.setOnline(false);
  local.select('welcome-rectangle');
  local.setSelectionAppearance({ fill: 'gold' });
  await session.flush();
  const replacement = new Promise<LoroDoc>((resolve, reject) =>
    createRoot((dispose) => {
      disposers.push(dispose);
      createEffect(
        on(session.state, (state) => {
          if (state.t === 'ready' && state.doc !== original) {
            dispose();
            resolve(state.doc);
          } else if (state.t === 'error') {
            dispose();
            reject(new Error(state.message));
          }
        })
      );
    })
  );
  server.emit({ type: 'update', update: new Uint8Array([0]) });
  expect(
    readSharedCanvas(await replacement).document.items['welcome-rectangle']
  ).toMatchObject({ appearance: { fill: 'gold' } });
});

it('never invents an empty seed when native content was declared ready but is missing', async () => {
  const server = room();
  const initialize = vi.fn(async () => {});
  const session = open({
    ...server,
    requireShared: true,
    exists: async () => false,
    initialize,
  });
  await expect(ready(session)).rejects.toThrow(
    'shared content is not initialized'
  );
  expect(initialize).not.toHaveBeenCalled();
});
