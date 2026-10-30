import { Mirror, SyncDirection } from '@loro-mirror/core';
import { LoroDoc, type PeerID, UndoManager } from 'loro-crdt';
import type { GraphicsBackend } from '../core/backend';
import type { GraphicsDocument } from '../core/model';
import { freezeDocument } from '../core/scene';
import { readScene, writeScene } from './scene-mapping';
import { canvasSchema } from './schema';

type Source = Parameters<Parameters<GraphicsBackend['subscribe']>[0]>[0];
/** Host bookkeeping is durable but must not become a scene undo step. */
export const GRAPHICS_METADATA_ORIGIN = 'graphics:metadata';

export function readLoroGraphicsDocument(doc: LoroDoc, rootId: string) {
  const mirror = new Mirror({ doc, schema: canvasSchema });
  try {
    return readScene(mirror.getState().scene, rootId).document;
  } finally {
    mirror.dispose();
  }
}

export function createLoroSeed(seed: GraphicsDocument): Uint8Array {
  const validated = freezeDocument(seed);
  const doc = new LoroDoc();
  doc.setPeerId('0');
  const mirror = new Mirror({ doc, schema: canvasSchema });
  mirror.setState({
    scene: writeScene(
      mirror.getState().scene,
      {
        rootId: seed.rootId,
        items: { [seed.rootId]: { id: seed.rootId, type: 'surface' } },
      },
      validated
    ),
  });
  doc.commit();
  const snapshot = doc.export({ mode: 'snapshot' });
  mirror.dispose();
  doc.free();
  return snapshot;
}

/** Experimental Loro owner; no browser, network, storage or Solid dependencies. */
export function createLoroGraphicsBackend(
  snapshot: Uint8Array,
  peerId: PeerID,
  rootId: string
) {
  const doc = new LoroDoc();
  try {
    doc.import(snapshot);
    doc.setPeerId(peerId);
    return graphicsBackend(doc, rootId, true);
  } catch (error) {
    doc.free();
    throw error;
  }
}

/** Bind a scene to a document owned by the host's durable sync runtime. */
export function createLoroGraphicsBackendFromDoc(
  doc: LoroDoc,
  rootId: string,
  canEdit: () => boolean = () => true
) {
  return graphicsBackend(doc, rootId, false, canEdit);
}

function graphicsBackend(
  doc: LoroDoc,
  rootId: string,
  ownsDocument: boolean,
  canEdit: () => boolean = () => true
) {
  const mirror = new Mirror({ doc, schema: canvasSchema });
  let projection: ReturnType<typeof readScene>;
  try {
    projection = readScene(mirror.getState().scene, rootId);
  } catch (error) {
    mirror.dispose();
    throw error;
  }
  const history = new UndoManager(doc, {
    mergeInterval: 0,
    maxUndoSteps: 100,
    excludeOriginPrefixes: [GRAPHICS_METADATA_ORIGIN],
  });
  let disposed = false;
  let applyingLocal = false;
  const listeners = new Set<(source: Source) => void>();
  const updates = new Set<(bytes: Uint8Array) => void>();
  const refresh = (source: Source) => {
    projection = readScene(mirror.getState().scene, rootId);
    for (const listener of listeners) listener(source);
  };
  const local = (source: Source, action: () => void) => {
    if (disposed || !canEdit()) return;
    const from = doc.oplogVersion();
    applyingLocal = true;
    try {
      action();
      doc.commit();
      const bytes = doc.export({ mode: 'update', from });
      refresh(source);
      for (const listener of updates) listener(bytes);
    } finally {
      applyingLocal = false;
      from.free();
    }
  };
  const unsubscribe = mirror.subscribe((_state, metadata) => {
    if (
      !disposed &&
      !applyingLocal &&
      metadata.direction === SyncDirection.FROM_LORO &&
      (!metadata.changedRoots || metadata.changedRoots.includes('scene'))
    )
      refresh('remote');
  });
  return {
    getDocument: () => projection.document,
    getClock() {
      if (disposed) return {};
      const version = doc.version();
      const clock = Object.fromEntries(version.toJSON());
      version.free();
      return clock;
    },
    getFrameConflicts: () => projection.frameConflicts,
    getHistory: () => ({
      canUndo: !disposed && canEdit() && history.canUndo(),
      canRedo: !disposed && canEdit() && history.canRedo(),
    }),
    commit(next: GraphicsDocument) {
      const validated = freezeDocument(next);
      local('local', () =>
        mirror.setState({
          scene: writeScene(
            mirror.getState().scene,
            projection.document,
            validated
          ),
        })
      );
    },
    undo() {
      if (!disposed && history.canUndo())
        local('history', () => {
          history.undo();
        });
    },
    redo() {
      if (!disposed && history.canRedo())
        local('history', () => {
          history.redo();
        });
    },
    subscribe(listener: (source: Source) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeUpdates(listener: (bytes: Uint8Array) => void) {
      updates.add(listener);
      return () => {
        updates.delete(listener);
      };
    },
    receive(bytes: Uint8Array) {
      if (disposed) return;
      doc.import(bytes);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      listeners.clear();
      updates.clear();
      history.free();
      mirror.dispose();
      if (ownsDocument) doc.free();
    },
  };
}
export type LoroGraphicsBackend = ReturnType<typeof createLoroGraphicsBackend>;
