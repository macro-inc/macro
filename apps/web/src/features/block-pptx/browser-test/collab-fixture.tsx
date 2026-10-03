/**
 * One collaborator of a shared presentation: the real editor over the real
 * sync service (the compiled Rust worker in Miniflare, see `sync-server.ts`),
 * without the app shell. Query parameters name the document, the user, and
 * the worker's URLs and token; `window.pptxFixture` exposes the engine and
 * the shared document to tests.
 */

import { noopChatter } from '@macro-inc/collaboration/collab/chatter';
import type { SnapshotStore } from '@macro-inc/collaboration/collab/snapshot-store';
import { InMemoryWALStore } from '@macro-inc/collaboration/collab/wal';
import { InitializeFromSnapshotRequest } from '@macro-inc/collaboration/sync-service/generated/schema';
import { createSyncSocket } from '@macro-inc/collaboration/sync-service/socket';
import {
  mapToSyncStatus,
  SyncServiceSource,
} from '@macro-inc/collaboration/sync-service/source';
import { createWebsocketStateSignal } from '@macro-inc/collaboration/websocket/solid/state-signal';
import { LoroDoc } from 'loro-crdt';
import { createSignal, Match, onCleanup, Show, Switch } from 'solid-js';
import {
  PptxEditorProvider,
  type PresentationEngine,
} from '../context/pptx-editor-context';
import { readEntries } from '../core/collab-entries';
import { createPresentationCollabSession } from '../queries/presentation-collab';
import {
  buildPresentationSeed,
  openCollaborativePresentation,
} from '../queries/presentation-engine';
import { PptxEditor } from '../views/pptx-editor';

class MemorySnapshots implements SnapshotStore<Uint8Array> {
  private value: Uint8Array | null = null;
  async save(snapshot: Uint8Array) {
    this.value = snapshot;
  }
  async load() {
    return this.value;
  }
  async delete() {
    this.value = null;
  }
}

const shortName = (id: string | undefined) =>
  (id ?? '')
    .replace(/^macro\|/, '')
    .split('@')[0]
    .replace(/^./, (c) => c.toUpperCase()) || 'Someone';

export function CollabFixture(props: {
  params: URLSearchParams;
  deckUrl: string;
}) {
  const documentId = props.params.get('document') ?? 'local';
  const worker = props.params.get('worker') ?? '';
  const socketUrl = props.params.get('socket') ?? '';
  const token = props.params.get('token') ?? '';
  const user = props.params.get('user') ?? 'macro|alice@example.com';
  const readonly = props.params.has('readonly');
  const [engine, setEngine] = createSignal<PresentationEngine>();
  const [errors, setErrors] = createSignal<string[]>([]);
  const deckBytes = fetch(props.deckUrl).then((r) => r.arrayBuffer());

  const session = createPresentationCollabSession({
    documentId,
    userId: user,
    canEdit: () => !readonly,
    displayName: shortName,
    exists: async () =>
      (
        await fetch(`${worker}document/${documentId}/exists`, {
          method: 'HEAD',
        })
      ).ok,
    buildSeed: async () =>
      buildPresentationSeed((await deckBytes).slice(0), () => new LoroDoc()),
    initialize: async (snapshot) => {
      const response = await fetch(
        `${worker}document/${documentId}/initialize`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: new Uint8Array(
            InitializeFromSnapshotRequest.encode({ snapshot })
          ),
        }
      );
      if (!response.ok)
        throw new Error(`initialize failed: ${response.status}`);
    },
    connect: () => {
      const socket = createSyncSocket(socketUrl);
      const state = createWebsocketStateSignal(socket);
      const source = new SyncServiceSource(socket, documentId, {
        status: () => mapToSyncStatus(state()),
      });
      return { source, doInitialSync: source.doInitialSync };
    },
    persistence: {
      snapshots: new MemorySnapshots(),
      wal: new InMemoryWALStore<Uint8Array>(),
      // Collaborators reach each other only through the sync service, even
      // when two of them share an origin (the side-by-side demo).
      makeChatter: () => noopChatter(),
    },
  });

  const doc = () => {
    const state = session.state();
    return state.t === 'ready' ? state.doc : undefined;
  };

  window.pptxFixture = {
    saved: () => null,
    saves: () => 0,
    engine,
    errors,
    notices: () => [],
    externalEdit: () => Promise.reject(new Error('not in collaboration mode')),
    collab: {
      status: session.collaboration.status,
      peers: session.collaboration.peers,
      ready: () => !!engine(),
      entries: () => {
        const current = doc();
        return current ? readEntries(current) : {};
      },
    },
  };

  return (
    <div class="flex h-screen flex-col bg-page text-ink">
      <header class="flex h-11 shrink-0 items-center gap-3 border-edge-muted border-b px-3 text-sm">
        <span class="font-semibold">{shortName(user)}</span>
        <span class="text-ink-muted text-xs" data-testid="fixture-collab">
          {session.collaboration.status()}
        </span>
      </header>
      <main class="min-h-0 flex-1">
        <Switch
          fallback={
            <div class="p-6 text-ink-muted text-sm">{session.state().t}</div>
          }
        >
          <Match when={doc()} keyed>
            {(ready) => {
              let closed = false;
              void openCollaborativePresentation(ready, {
                storedFile: new ArrayBuffer(0),
              }).then(
                (e) => (closed ? e.close() : setEngine(e)),
                (e: unknown) => setErrors((list) => [...list, String(e)])
              );
              onCleanup(() => {
                closed = true;
                engine()?.close();
                setEngine(undefined);
              });
              return (
                <Show when={engine()} keyed>
                  {(e) => (
                    <PptxEditorProvider
                      context={{
                        engine: e,
                        persist: async () => {},
                        canEdit: () => !readonly,
                        fileName: () => 'Presentation.pptx',
                        download: () => {},
                        notifyError: (message) =>
                          setErrors((list) => [...list, message]),
                        autosaveDelay: 0,
                        collaboration: session.collaboration,
                      }}
                    >
                      <PptxEditor />
                    </PptxEditorProvider>
                  )}
                </Show>
              );
            }}
          </Match>
        </Switch>
      </main>
    </div>
  );
}
