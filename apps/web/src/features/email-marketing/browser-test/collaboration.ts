import { createLoroManager } from '@macro-inc/collaboration/collab/manager';
import {
  type LiveSyncSource,
  type SyncSourceEvent,
  SyncSourceStatus,
} from '@macro-inc/collaboration/collab/source';
import { MARKDOWN_LORO_SCHEMA } from '@macro-inc/lexical-core/markdown-loro-schema';
import { markdownToLoroSnapshot } from '@macro-inc/lexical-core/markdown-loro-snapshot';
import { LoroDoc } from 'loro-crdt';
import { okAsync } from 'neverthrow';
import { createSignal } from 'solid-js';
import type {
  SequenceContentOptions,
  SequenceContentSession,
} from '../context/contracts';
import { sequenceContentId } from '../core/content-identity';

let failedInitialConnection = false;

/** Real Loro editors, isolated transport: browser locks + BroadcastChannel replace the server. */
export function createTestContentSession(
  options: SequenceContentOptions
): SequenceContentSession {
  const sourceId = sequenceContentId(options);
  const loroManager = createLoroManager(MARKDOWN_LORO_SCHEMA, {
    documentId: sourceId,
  });
  const [syncSource, setSyncSource] = createSignal<LiveSyncSource>();
  const [connectionError, setConnectionError] = createSignal<string>();
  let disposed = false;
  let channel: BroadcastChannel | undefined;
  const key = `marketing-test-surface:${sourceId}`;
  void (async () => {
    try {
      if (
        new URLSearchParams(location.search).get('failContent') === 'once' &&
        !failedInitialConnection
      ) {
        failedInitialConnection = true;
        throw new Error('Test: shared content could not be loaded.');
      }
      const seed = await navigator.locks.request(key, async () => {
        let value = localStorage.getItem(key);
        if (!value) {
          const snapshot = await markdownToLoroSnapshot(options.initialText);
          if (!snapshot) throw new Error('Could not create the test snapshot.');
          value = JSON.stringify([...snapshot]);
          localStorage.setItem(key, value);
        }
        return Uint8Array.from(JSON.parse(value));
      });
      if (disposed) return;
      const server = new LoroDoc();
      server.import(seed);
      const listeners = new Set<(event: SyncSourceEvent) => void>();
      channel = new BroadcastChannel(key);
      channel.onmessage = (event: MessageEvent<SyncSourceEvent>) => {
        if (event.data.type === 'update') server.import(event.data.update);
        for (const listener of listeners) listener(event.data);
      };
      const source: LiveSyncSource = {
        documentId: sourceId,
        listen: (listener) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        async pushUpdate(updates) {
          await navigator.locks.request(key, () => {
            const stored = localStorage.getItem(key);
            if (stored) server.import(Uint8Array.from(JSON.parse(stored)));
            for (const update of updates) server.import(update);
            localStorage.setItem(
              key,
              JSON.stringify([...server.export({ mode: 'snapshot' })])
            );
          });
          for (const update of updates)
            channel?.postMessage({ type: 'update', update });
          return true;
        },
        pushAwareness(awareness) {
          channel?.postMessage({ type: 'awareness', awareness });
        },
        registerPeerId() {},
        status: () => SyncSourceStatus.Connected,
        requestUpdatesSince: (from) =>
          okAsync(server.export({ mode: 'update', from })),
        requestSnapshot: () => okAsync(server.export({ mode: 'snapshot' })),
        reconnect() {},
        cleanup: () => {
          channel?.close();
          listeners.clear();
        },
      };
      await loroManager.ingest({ kind: 'dss', snapshot: seed });
      if (!disposed) setSyncSource(source);
    } catch (error) {
      if (!disposed)
        setConnectionError(
          error instanceof Error ? error.message : String(error)
        );
    }
  })();
  return {
    sourceId,
    loroManager,
    syncSource,
    connectionError,
    dispose() {
      disposed = true;
      syncSource()?.cleanup();
      channel?.close();
    },
  };
}
