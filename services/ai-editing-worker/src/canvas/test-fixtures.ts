import {
  createNoopLiveSyncSource,
  type SyncSourceEvent,
} from '@macro-inc/collaboration/collab/source';
import { createScene } from '@macro-inc/graphics';
import { createLoroSeed } from '@macro-inc/graphics/loro';
import { LoroDoc } from 'loro-crdt';
import { okAsync } from 'neverthrow';
import type { CanvasSource } from './session';

export function liveScene() {
  const server = new LoroDoc();
  server.import(createLoroSeed(createScene()));
  server.setPeerId('0');
  server.getMap('canvasMeta').set('format', 1);
  server.getMap('canvasMeta').set('rootId', 'scene-root');
  server.commit();
  const listeners = new Set<(event: SyncSourceEvent) => void>();
  let closed = false;
  let writes = 0;
  const source: CanvasSource = {
    ...createNoopLiveSyncSource('canvas-test'),
    doInitialSync: () =>
      okAsync({
        snapshot: server.export({ mode: 'snapshot' }),
        awareness: new Uint8Array(),
      }),
    requestUpdatesSince: (version) =>
      okAsync(server.export({ mode: 'update', from: version })),
    requestSnapshot: () => okAsync(server.export({ mode: 'snapshot' })),
    listen(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async pushUpdate(updates) {
      writes += updates.length;
      updates.forEach((update) => server.import(update));
      return true;
    },
    cleanup() {
      closed = true;
      listeners.clear();
    },
  };
  return {
    server,
    source,
    closed: () => closed,
    writes: () => writes,
    send: (event: SyncSourceEvent) =>
      listeners.forEach((listener) => listener(event)),
  };
}
