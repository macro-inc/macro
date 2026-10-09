/**
 * Several people editing one Illustrator document side by side
 * (`?collab`): each runs the real shared-document session (Loro document,
 * WAL, awareness), engine, sharing, and editor, connected through an
 * in-page sync server (the Figma fixture's `memory-sync.ts`), which also
 * holds the stored file. `window.aiFixture.collab` exposes each person's
 * engine, saves, status, and peers, and can store a file outside the
 * session, reopen a person, or take the server down.
 */

import { MemorySyncServer } from '@app/features/block-fig/browser-test/memory-sync';
import { AiEngine } from '@core/ai-engine/client';
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
import { SessionNotice } from '../components/notices';
import { AiEditorProvider, type AiSharing } from '../context/ai-editor-context';
import { fileFingerprint } from '../core/collab-entries';
import { createAiCollabSession } from '../queries/ai-collab';
import { shareAiEngine } from '../queries/ai-sharing';
import { AiEditorView } from '../views/ai-editor';

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
  engine: () => AiEngine | undefined;
  /** The id session this person creates objects in. */
  session: () => number | undefined;
  /** Files this person stored. */
  saves: () => number;
  status: () => string;
  /** Names of the people this person sees. */
  peers: () => string[];
}

/** The fixture's controls, for tests. */
export interface FixtureCollab {
  people: () => FixturePerson[];
  /** Stores a new blank document outside the session (an upload, say). */
  storeOutside: () => Promise<void>;
  /** Closes a person's document and opens the stored file again. */
  reopen: (name: string) => void;
  /** Takes the sync server down (`false`) or brings it back. */
  setReachable: (reachable: boolean) => void;
  /** The stored file, as people open it. */
  stored: () => Uint8Array;
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
  const documentId = 'fixture-illustration';
  const [engine, setEngine] = createSignal<AiEngine>();
  const [sharing, setSharing] = createSignal<AiSharing>();
  const [saves, setSaves] = createSignal(0);
  const [failure, setFailure] = createSignal<string>();
  const [replaced, setReplaced] = createSignal(false);
  const session = createAiCollabSession({
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
    session: () => sharing()?.session,
    saves,
    status: () =>
      `${session.state().t} ${session.collaboration.status()}${replaced() ? ' replaced' : ''}${failure() ? ` ${failure()}` : ''}`,
    peers: () => session.collaboration.peers().map((p) => p.name),
  });

  /** Opens the stored file, shared through `shared` when given. */
  const openDocument = (shared?: Parameters<typeof shareAiEngine>[1]) => {
    let closed = false;
    let opened: AiEngine | undefined;
    let sharedEngine: AiSharing | undefined;
    const open = async () => {
      try {
        const bytes = props.server.stored();
        const fingerprint = await fileFingerprint(bytes);
        opened = await AiEngine.open(bytes);
        if (closed) return;
        if (shared) {
          sharedEngine = await shareAiEngine(opened, shared, {
            fingerprint,
            takenSessions: () =>
              session.collaboration.peers().map((p) => p.presence.session),
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

  const editor = (editable: () => boolean, live: boolean) => (
    <Show when={engine()} keyed>
      {(e) => (
        <AiEditorProvider
          context={{
            engine: e,
            fileName: () => 'Illustration',
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
          <AiEditorView />
        </AiEditorProvider>
      )}
    </Show>
  );

  return (
    <section class="flex min-w-0 flex-1 flex-col border-edge-muted border-r">
      <header class="flex h-8 shrink-0 items-center gap-2 border-edge-muted border-b px-3 text-xs">
        <strong>{shortName(props.user)}</strong>
        <span class="text-ink-muted" data-testid="ai-person-status">
          {session.state().t} · {session.collaboration.status()}
        </span>
      </header>
      <div
        class="flex min-h-0 flex-1 flex-col"
        data-testid={`ai-person-${shortName(props.user)}`}
      >
        <Switch>
          <Match when={failure()}>
            {(message) => <div class="p-4 text-failure">{message()}</div>}
          </Match>
          <Match when={failed()}>
            {(message) => {
              onMount(() => openDocument());
              return (
                <>
                  <SessionNotice
                    message={`${message()} The file is open read-only.`}
                    action="Retry"
                    onAction={props.retry}
                  />
                  <div class="min-h-0 flex-1">{editor(() => false, false)}</div>
                </>
              );
            }}
          </Match>
          <Match when={doc()} keyed>
            {(ready) => {
              onMount(() => openDocument(ready));
              return (
                <>
                  <Show when={replaced()}>
                    <SessionNotice
                      message="This file was replaced by a newer version. Reload to edit the latest version."
                      action="Reload"
                      onAction={props.retry}
                    />
                  </Show>
                  <div class="min-h-0 flex-1">
                    {editor(() => !replaced(), true)}
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

export function CollabFixture(props: {
  load: () => Promise<Uint8Array>;
  users: string[];
}) {
  const server = new MemorySyncServer();
  const [stored, setStored] = createSignal(false);
  const load = async () => {
    server.store(await props.load());
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
      server.store(await AiEngine.blank(640, 480));
    },
    reopen: (name) => {
      const user = props.users.find((u) => shortName(u) === name);
      if (user) reopen(user);
    },
    setReachable: (reachable) => {
      server.reachable = reachable;
    },
    stored: () => new Uint8Array(server.stored()),
  };
  window.aiFixture.collab = controls;
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
