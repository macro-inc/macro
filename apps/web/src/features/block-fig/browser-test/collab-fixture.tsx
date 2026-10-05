/**
 * Several people editing one design side by side (`?collab&file=…`): each
 * runs the real design session (Loro document, WAL, awareness), engine,
 * sharing, and viewer, connected through an in-page sync server
 * (`memory-sync.ts`), which also holds the stored file. `window.figFixture
 * .collab` exposes each person's engine, saves, and status, and can store a
 * file outside the session, reopen a person, or take the server down.
 */

import { FigEngine } from '@core/fig-engine/client';
import type { SnapshotStore } from '@macro-inc/browser-store/snapshot-store';
import { InMemoryWALStore } from '@macro-inc/browser-store/wal-store';
import { noopChatter } from '@macro-inc/collaboration/collab/chatter';
import {
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { SessionNotice } from '../components/session-notice';
import {
  type FigSharing,
  FigViewerProvider,
} from '../context/fig-viewer-context';
import { fileFingerprint } from '../core/collab-entries';
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

/** The fixture's controls, for tests. */
export interface FixtureCollab {
  people: () => FixturePerson[];
  /** Stores a new blank design outside the session (an upload, say). */
  storeOutside: () => Promise<void>;
  /** Closes a person's design and opens the stored file again. */
  reopen: (name: string) => void;
  /** Takes the sync server down (`false`) or brings it back. */
  setReachable: (reachable: boolean) => void;
}

const shortName = (id: string | undefined) =>
  (id ?? '')
    .replace(/^macro\|/, '')
    .split('@')[0]
    .replace(/^./, (c) => c.toUpperCase()) || 'Someone';

function Person(props: {
  user: string;
  server: MemorySyncServer;
  onPerson: (person: FixturePerson) => void;
  retry: () => void;
}) {
  const documentId = 'fixture-design';
  const [engine, setEngine] = createSignal<FigEngine>();
  const [sharing, setSharing] = createSignal<FigSharing>();
  const [saves, setSaves] = createSignal(0);
  const [failure, setFailure] = createSignal<string>();
  const [replaced, setReplaced] = createSignal(false);
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
  const failed = () => {
    const state = session.state();
    return state.t === 'error' ? state.message : undefined;
  };
  props.onPerson({
    name: shortName(props.user),
    engine,
    saves,
    status: () =>
      `${session.state().t} ${session.collaboration.status()}${replaced() ? ' replaced' : ''}${failure() ? ` ${failure()}` : ''}`,
    peers: () => session.collaboration.peers().map((p) => p.name),
  });

  /** Opens the stored file, shared through `shared` when given. */
  const openDesign = (shared?: Parameters<typeof shareFigEngine>[1]) => {
    let closed = false;
    let opened: FigEngine | undefined;
    let sharedEngine: FigSharing | undefined;
    const open = async () => {
      try {
        const bytes = props.server.stored();
        const fingerprint = await fileFingerprint(bytes);
        opened = await FigEngine.open(bytes);
        if (closed) return;
        if (shared) {
          sharedEngine = await shareFigEngine(opened, shared, {
            fingerprint,
            delivered: session.delivered,
          });
          if (closed) return;
          sharedEngine.onReplaced(() => setReplaced(true));
          setSharing(sharedEngine);
        }
        setEngine(opened);
      } catch (e) {
        setFailure(String(e));
      }
    };
    void open();
    onCleanup(() => {
      closed = true;
      sharedEngine?.close();
      opened?.close();
      setEngine(undefined);
      setSharing(undefined);
    });
  };

  const viewer = (editable: () => boolean, live: boolean) => (
    <Show when={engine()} keyed>
      {(e) => (
        <FigViewerProvider
          context={{
            engine: e,
            fileName: () => 'Design',
            download: () => {},
            notifyError: (m) => setFailure(m),
            notifyInfo: () => {},
            canEdit: editable,
            save: async (bytes) => {
              props.server.store(bytes);
              setSaves((n) => n + 1);
            },
            collaboration: live ? session.collaboration : undefined,
            sharing: sharing(),
          }}
        >
          <FigViewer />
        </FigViewerProvider>
      )}
    </Show>
  );

  return (
    <section class="flex min-w-0 flex-1 flex-col border-edge-muted border-r">
      <header class="flex h-8 shrink-0 items-center gap-2 border-edge-muted border-b px-3 text-xs">
        <strong>{shortName(props.user)}</strong>
        <span class="text-ink-muted" data-testid="fig-person-status">
          {session.state().t} · {session.collaboration.status()}
        </span>
      </header>
      <div
        class="flex min-h-0 flex-1 flex-col"
        data-testid={`fig-person-${shortName(props.user)}`}
      >
        <Switch>
          <Match when={failure()}>
            {(message) => <div class="p-4 text-failure">{message()}</div>}
          </Match>
          <Match when={failed()}>
            {(message) => {
              onMount(() => openDesign());
              return (
                <>
                  <SessionNotice
                    message={`${message()} The design is open read-only.`}
                    action="Retry"
                    onAction={props.retry}
                  />
                  <div class="min-h-0 flex-1">{viewer(() => false, false)}</div>
                </>
              );
            }}
          </Match>
          <Match when={doc()} keyed>
            {(ready) => {
              onMount(() => openDesign(ready));
              return (
                <>
                  <Show when={replaced()}>
                    <SessionNotice
                      message="This design was replaced by a newer file. Reload to edit the latest version."
                      action="Reload"
                      onAction={props.retry}
                    />
                  </Show>
                  <div class="min-h-0 flex-1">
                    {viewer(() => !replaced(), true)}
                  </div>
                </>
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
  const [stored, setStored] = createSignal(false);
  const load = async () => {
    const r = await fetch(props.fileUrl);
    if (!r.ok) throw new Error(`${props.fileUrl}: ${r.status}`);
    server.store(new Uint8Array(await r.arrayBuffer()));
    setStored(true);
  };
  void load();
  const people = new Map<string, FixturePerson>();
  const [opened, setOpened] = createSignal<Record<string, number>>({});
  const reopen = (user: string) =>
    setOpened((o) => ({ ...o, [user]: (o[user] ?? 0) + 1 }));
  const controls: FixtureCollab = {
    people: () =>
      props.users.flatMap((u) => {
        const p = people.get(u);
        return p ? [p] : [];
      }),
    storeOutside: async () => {
      server.store(await FigEngine.blank('Replaced'));
    },
    reopen: (name) => {
      const user = props.users.find((u) => shortName(u) === name);
      if (user) reopen(user);
    },
    setReachable: (reachable) => {
      server.reachable = reachable;
    },
  };
  window.figFixture.collab = controls;
  return (
    <div class="flex min-h-0 flex-1">
      <Show when={stored()}>
        <For each={props.users}>
          {(user) => (
            // The child's parameter makes Show call it again for each key.
            <Show when={(opened()[user] ?? 0) + 1} keyed>
              {(_opening) => (
                <Person
                  user={user}
                  server={server}
                  onPerson={(p) => people.set(user, p)}
                  retry={() => reopen(user)}
                />
              )}
            </Show>
          )}
        </For>
      </Show>
    </div>
  );
}
