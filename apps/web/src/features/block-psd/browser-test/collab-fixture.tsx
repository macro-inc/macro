/**
 * Several people editing one document side by side (`?collab`): each runs
 * the real shared-document session (Loro document, WAL, awareness), engine,
 * sharing, and editor, connected through an in-page sync server (the Figma
 * fixture's `memory-sync.ts`), which also holds the stored file.
 * `window.psdFixture.collab` exposes each person's engine, saves, and
 * status, and can store a file outside the session, reopen a person, or
 * take the server down.
 */

import { MemorySyncServer } from '@app/features/block-fig/browser-test/memory-sync';
import { PsdEngine } from '@core/psd-engine/client';
import { noopChatter } from '@macro-inc/collaboration/collab/chatter';
import type { SnapshotStore } from '@macro-inc/collaboration/collab/snapshot-store';
import { InMemoryWALStore } from '@macro-inc/collaboration/collab/wal';
import type { LoroDoc } from 'loro-crdt';
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
  PsdEditorProvider,
  type PsdSharing,
} from '../context/psd-editor-context';
import { fileFingerprint } from '../core/collab-entries';
import { createPsdCollabSession } from '../queries/psd-collab';
import { sharePsdEngine } from '../queries/psd-sharing';
import { PsdEditor } from '../views/psd-editor';

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
  engine: () => PsdEngine | undefined;
  /** Files this person stored. */
  saves: () => number;
  status: () => string;
  /** Names of the people this person sees. */
  peers: () => string[];
  /** Messages this person's editor reported. */
  errors: () => string[];
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
  const documentId = 'fixture-psd';
  const [engine, setEngine] = createSignal<PsdEngine>();
  const [sharing, setSharing] = createSignal<PsdSharing>();
  const [saves, setSaves] = createSignal(0);
  const [failure, setFailure] = createSignal<string>();
  /** Messages the editor reported (it stays open). */
  const [errors, setErrors] = createSignal<string[]>([]);
  const [replaced, setReplaced] = createSignal(false);
  const session = createPsdCollabSession({
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
    errors,
  });

  /** Opens the stored file, shared through `shared` when given. */
  const openDocument = (shared?: LoroDoc) => {
    let closed = false;
    let opened: PsdEngine | undefined;
    let sharedEngine: PsdSharing | undefined;
    const open = async () => {
      try {
        const bytes = props.server.stored();
        const fingerprint = await fileFingerprint(bytes);
        opened = await PsdEngine.open(bytes);
        if (closed) return;
        if (shared) {
          sharedEngine = await sharePsdEngine(opened, shared, {
            fingerprint,
            sessionsTaken: session.collaboration
              .peers()
              .map((p) => p.presence.session),
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
        <PsdEditorProvider
          context={{
            engine: e,
            fileName: () => 'Image',
            download: () => {},
            notifyError: (m) => setErrors((e) => [...e, m]),
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
          <PsdEditor />
        </PsdEditorProvider>
      )}
    </Show>
  );

  return (
    <section class="flex min-w-0 flex-1 flex-col border-edge-muted border-r">
      <header class="flex h-8 shrink-0 items-center gap-2 border-edge-muted border-b px-3 text-xs">
        <strong>{shortName(props.user)}</strong>
        <span class="text-ink-muted" data-testid="psd-person-status">
          {session.state().t} · {session.collaboration.status()}
        </span>
        <Show when={errors().at(-1)}>
          {(message) => (
            <span class="truncate text-failure" data-testid="psd-person-error">
              {message()}
            </span>
          )}
        </Show>
      </header>
      <div
        class="flex min-h-0 flex-1 flex-col"
        data-testid={`psd-person-${shortName(props.user)}`}
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
                    message={`${message()} The document is open read-only.`}
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
                      message="This document was replaced by a newer file. Reload to edit the latest version."
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
  /** The stored file; a new document of `size` without one. */
  fileUrl?: string;
  size: { width: number; height: number };
  users: string[];
}) {
  const server = new MemorySyncServer();
  const [stored, setStored] = createSignal(false);
  const [error, setError] = createSignal<string>();
  const load = async () => {
    if (props.fileUrl) {
      const r = await fetch(props.fileUrl);
      if (!r.ok) throw new Error(`${props.fileUrl}: ${r.status}`);
      server.store(new Uint8Array(await r.arrayBuffer()));
    } else {
      server.store(
        await PsdEngine.blank(props.size.width, props.size.height, true)
      );
    }
    setStored(true);
  };
  void load().catch((e: unknown) => setError(String(e)));
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
      server.store(
        await PsdEngine.blank(props.size.width, props.size.height, false)
      );
    },
    reopen: (name) => {
      const user = props.users.find((u) => shortName(u) === name);
      if (user) reopen(user);
    },
    setReachable: (reachable) => {
      server.reachable = reachable;
    },
  };
  window.psdFixture.collab = controls;
  return (
    <div class="flex min-h-0 flex-1">
      <Show when={error()}>
        {(message) => (
          <div class="p-6 text-failure" data-testid="psd-fixture-error">
            {message()}
          </div>
        )}
      </Show>
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
