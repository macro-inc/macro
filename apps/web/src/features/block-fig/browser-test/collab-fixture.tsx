/**
 * Several people editing one design side by side (`?collab&file=…`): each
 * runs the real design session (Loro document, WAL, awareness), engine,
 * sharing, and viewer, connected through an in-page sync server
 * (`memory-sync.ts`). `window.figFixture.collab` exposes each person's
 * engine, saves, and status.
 */

import { FigEngine } from '@core/fig-engine/client';
import { noopChatter } from '@macro-inc/collaboration/collab/chatter';
import type { SnapshotStore } from '@macro-inc/collaboration/collab/snapshot-store';
import { InMemoryWALStore } from '@macro-inc/collaboration/collab/wal';
import {
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import {
  type FigSharing,
  FigViewerProvider,
} from '../context/fig-viewer-context';
import { createDesignCollabSession } from '../queries/fig-collab';
import { shareFigEngine } from '../queries/fig-sharing';
import { FigViewer } from '../views/fig-viewer';
import { MemorySyncServer } from './memory-sync';

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

/** One person's state, for tests. */
export interface FixturePerson {
  name: string;
  engine: () => FigEngine | undefined;
  /** Files this person stored. */
  saves: () => number;
  status: () => string;
  /** Names of the people this person sees. */
  peers: () => string[];
}

const shortName = (id: string | undefined) =>
  (id ?? '')
    .replace(/^macro\|/, '')
    .split('@')[0]
    .replace(/^./, (c) => c.toUpperCase()) || 'Someone';

function Person(props: {
  user: string;
  bytes: Promise<ArrayBuffer>;
  server: MemorySyncServer;
  onPerson: (person: FixturePerson) => void;
}) {
  const documentId = 'fixture-design';
  const [engine, setEngine] = createSignal<FigEngine>();
  const [sharing, setSharing] = createSignal<FigSharing>();
  const [saves, setSaves] = createSignal(0);
  const [failure, setFailure] = createSignal<string>();
  const session = createDesignCollabSession({
    documentId,
    userId: props.user,
    canEdit: () => true,
    displayName: shortName,
    exists: () => props.server.exists(),
    initialize: (snapshot) => props.server.initialize(snapshot),
    connect: () => props.server.connect(documentId),
    persistence: {
      snapshots: new MemorySnapshots(),
      wal: new InMemoryWALStore<Uint8Array>(),
      // People reach each other only through the server.
      makeChatter: () => noopChatter(),
    },
  });
  const doc = () => {
    const state = session.state();
    return state.t === 'ready' ? state.doc : undefined;
  };
  props.onPerson({
    name: shortName(props.user),
    engine,
    saves,
    status: () =>
      `${session.state().t} ${session.collaboration.status()}${failure() ? ` ${failure()}` : ''}`,
    peers: () => session.collaboration.peers().map((p) => p.name),
  });

  return (
    <section class="flex min-w-0 flex-1 flex-col border-edge-muted border-r">
      <header class="flex h-8 shrink-0 items-center gap-2 border-edge-muted border-b px-3 text-xs">
        <strong>{shortName(props.user)}</strong>
        <span class="text-ink-muted" data-testid="fig-person-status">
          {session.state().t} · {session.collaboration.status()}
        </span>
      </header>
      <div
        class="min-h-0 flex-1"
        data-testid={`fig-person-${shortName(props.user)}`}
      >
        <Switch>
          <Match when={failure()}>
            {(message) => <div class="p-4 text-failure">{message()}</div>}
          </Match>
          <Match when={doc()} keyed>
            {(ready) => {
              onMount(() => {
                let closed = false;
                let opened: FigEngine | undefined;
                let shared: FigSharing | undefined;
                const open = async () => {
                  try {
                    opened = await FigEngine.open(await props.bytes);
                    if (closed) return;
                    shared = await shareFigEngine(opened, ready);
                    if (closed) return;
                    setSharing(shared);
                    setEngine(opened);
                  } catch (e) {
                    setFailure(String(e));
                  }
                };
                void open();
                onCleanup(() => {
                  closed = true;
                  shared?.close();
                  opened?.close();
                  setEngine(undefined);
                });
              });
              return (
                <Show when={engine()} keyed>
                  {(e) => (
                    <FigViewerProvider
                      context={{
                        engine: e,
                        fileName: () => 'Design',
                        download: () => {},
                        notifyError: (m) => setFailure(m),
                        notifyInfo: () => {},
                        canEdit: () => true,
                        save: async () => {
                          setSaves((n) => n + 1);
                        },
                        collaboration: session.collaboration,
                        sharing: sharing(),
                      }}
                    >
                      <FigViewer />
                    </FigViewerProvider>
                  )}
                </Show>
              );
            }}
          </Match>
        </Switch>
      </div>
    </section>
  );
}

export function CollabFixture(props: { fileUrl: string; users: string[] }) {
  const server = new MemorySyncServer();
  const bytes = fetch(props.fileUrl).then((r) => {
    if (!r.ok) throw new Error(`${props.fileUrl}: ${r.status}`);
    return r.arrayBuffer();
  });
  const people: FixturePerson[] = [];
  window.figFixture.collab = { people: () => people };
  return (
    <div class="flex min-h-0 flex-1">
      <For each={props.users}>
        {(user) => (
          <Person
            user={user}
            bytes={bytes}
            server={server}
            onPerson={(p) => people.push(p)}
          />
        )}
      </For>
    </div>
  );
}
