import '@fontsource-variable/inter';
import '../../../index.css';
import { noopChatter } from '@macro-inc/collaboration/collab/chatter';
import type { SnapshotStore } from '@macro-inc/collaboration/collab/snapshot-store';
import { InMemoryWALStore } from '@macro-inc/collaboration/collab/wal';
import {
  type DocxAgentRequest,
  type DocxAgentResult,
  runDocxAgentRequest,
} from '@macro-inc/collaboration/docx/agent';
import { readDocxState } from '@macro-inc/collaboration/docx/schema';
import { InitializeFromSnapshotRequest } from '@macro-inc/collaboration/sync-service/generated/schema';
import { createSyncSocket } from '@macro-inc/collaboration/sync-service/socket';
import {
  mapToSyncStatus,
  SyncServiceSource,
} from '@macro-inc/collaboration/sync-service/source';
import { createWebsocketStateSignal } from '@macro-inc/collaboration/websocket/solid/state-signal';
import type { MessageListItem } from '@service-storage/messages';
import type { LoroDoc } from 'loro-crdt';
import { createSignal, onCleanup, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { readCommentMarks } from '../core/comment-marks';
import { buildSeedSnapshot } from '../core/docx-seed';
import ComplexMsa from '../core/fixtures/complex-msa.docx?url';
import MutualNda from '../core/fixtures/mutual-nda.docx?url';
import { contentText } from '../core/text-offsets';
import type { LocatedThread } from '../primitives/create-docx-comments';
import type { createDocxEditor } from '../primitives/create-docx-editor';
import { createDocxSession } from '../queries/docx-session';
import {
  type DocxodusRuntime,
  loadDocxodus,
} from '../queries/docxodus-runtime';
import { DocxEditorView } from '../views/DocxEditorView';
import { DocxMarginLayout } from '../views/DocxMarginLayout';

type Handle = ReturnType<typeof createDocxEditor>;

declare global {
  interface Window {
    docxFixture?: {
      status: () => string;
      ready: () => boolean;
      paragraphs: () => string[];
      sharedOrder: () => string[];
      sharedBlocks: () => Array<[string, string]>;
      /** Run an AI tool request as the editing worker does: its own peer. */
      agent: (request: DocxAgentRequest) => Promise<DocxAgentResult>;
      marks: () => Record<string, unknown>;
      handle: () => Handle | undefined;
    };
  }
}

const FIXTURES: Record<string, string> = {
  'mutual-nda.docx': MutualNda,
  'complex-msa.docx': ComplexMsa,
};

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

const params = new URLSearchParams(location.search);
const documentId = params.get('document') ?? 'local';
const worker = params.get('worker') ?? '';
const socketUrl = params.get('socket') ?? '';
const token = params.get('token') ?? '';
const user = params.get('user') ?? 'macro|alice@example.com';
const readonly = params.has('readonly');
const fixture =
  FIXTURES[params.get('fixture') ?? 'mutual-nda.docx'] ?? MutualNda;

const shortName = (id: string | undefined) =>
  (id ?? '')
    .replace(/^macro\|/, '')
    .split('@')[0]
    .replace(/^./, (c) => c.toUpperCase());

/**
 * Fixture-only stand-in for the message store: threads live in a side map
 * of the synced document so every collaborator sees them. Production threads
 * come from the shared messages API.
 */
const FIXTURE_THREADS = 'fixtureThreads';

function watchFixtureThreads(
  doc: LoroDoc,
  set: (roots: MessageListItem[]) => void
) {
  const map = doc.getMap(FIXTURE_THREADS);
  const read = () =>
    set(
      map
        .keys()
        .map((key) => JSON.parse(String(map.get(key))) as MessageListItem)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
    );
  read();
  onCleanup(map.subscribe(read));
}

function postFixtureThread(doc: LoroDoc, markId: string, content: string) {
  const now = new Date().toISOString();
  doc.getMap(FIXTURE_THREADS).set(
    markId,
    JSON.stringify({
      id: markId,
      content,
      sender_id: user,
      created_at: now,
      updated_at: now,
      attachments: [],
      mentions: [],
      reactions: [],
      parent: { type: 'document', id: documentId },
      state: {
        anchor: { type: 'markdown', mark_id: markId },
        resolved: false,
        root_id: markId,
        created_at: now,
        updated_at: now,
        user_id: user,
      },
      thread: { preview: [], reply_count: 0 },
    })
  );
  doc.commit();
}

function resolveFixtureThread(doc: LoroDoc, id: string, resolved: boolean) {
  const map = doc.getMap(FIXTURE_THREADS);
  const root = JSON.parse(String(map.get(id))) as MessageListItem;
  map.set(id, JSON.stringify({ ...root, state: { ...root.state, resolved } }));
  doc.commit();
}

function FixtureThreadCard(props: {
  thread: LocatedThread;
  active: boolean;
  onPost: (text: string) => Promise<unknown>;
  onCancel: () => void;
  onResolve: (resolved: boolean) => void;
}) {
  const [text, setText] = createSignal('');
  return (
    <div
      data-fixture-thread={props.thread.root ? props.thread.id : 'draft'}
      class="rounded-xl border border-edge bg-surface p-3 text-sm shadow-md"
      classList={{ '-translate-x-2': props.active }}
    >
      <Show
        when={props.thread.root}
        fallback={
          <form
            class="flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void props.onPost(text());
            }}
          >
            <textarea
              aria-label="Comment text"
              placeholder="Leave a comment..."
              class="min-h-16 rounded-lg border border-edge-muted bg-input p-2 text-sm text-ink"
              onInput={(event) => setText(event.currentTarget.value)}
            />
            <div class="flex justify-end gap-2">
              <button
                type="button"
                class="rounded-md px-2 py-1 text-xs text-ink-muted"
                onClick={() => props.onCancel()}
              >
                Cancel
              </button>
              <button
                type="submit"
                class="rounded-md bg-accent px-3 py-1 text-xs text-accent-contrast"
              >
                Comment
              </button>
            </div>
          </form>
        }
      >
        {(root) => (
          <div class="flex flex-col gap-1">
            <div class="flex items-center gap-2">
              <span class="flex size-5 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-accent-contrast">
                {shortName(root().sender_id).slice(0, 1)}
              </span>
              <span class="text-xs font-medium text-ink">
                {shortName(root().sender_id)}
              </span>
              <Show when={root().state.resolved}>
                <span class="text-xs text-success">Resolved</span>
              </Show>
            </div>
            <p class="text-sm text-ink">{root().content}</p>
            <Show when={props.active}>
              <div class="flex justify-end">
                <button
                  type="button"
                  class="rounded-md px-2 py-1 text-xs text-ink-muted"
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onResolve(!root().state.resolved);
                  }}
                >
                  {root().state.resolved ? 'Reopen' : 'Resolve'}
                </button>
              </div>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}

function Fixture() {
  const [runtime, setRuntime] = createSignal<DocxodusRuntime>();
  const [handle, setHandle] = createSignal<Handle>();
  const [roots, setRoots] = createSignal<MessageListItem[]>([]);
  void loadDocxodus().then(setRuntime);

  const session = createDocxSession({
    documentId,
    userId: user,
    canEdit: () => !readonly,
    canComment: () => true,
    exists: async () =>
      (
        await fetch(`${worker}document/${documentId}/exists`, {
          method: 'HEAD',
        })
      ).ok,
    fetchOriginal: async () =>
      new Uint8Array(await (await fetch(fixture)).arrayBuffer()),
    buildSeed: async (original) =>
      buildSeedSnapshot(
        (await loadDocxodus()).exports.DocxSessionBridge,
        original
      ),
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
      // when two of them share an origin (the side-by-side demo stage).
      makeChatter: () => noopChatter(),
    },
  });

  window.docxFixture = {
    status: session.status,
    ready: () => !!handle(),
    paragraphs: () =>
      Array.from(
        document.querySelectorAll<HTMLElement>('.docx-body-flow [data-anchor]')
      )
        .filter((element) => !element.querySelector('[data-anchor]'))
        .map(contentText),
    sharedOrder: () => {
      const state = session.state();
      return state.t === 'ready' ? readDocxState(state.doc).order : [];
    },
    sharedBlocks: () => {
      const state = session.state();
      if (state.t !== 'ready') return [];
      const shared = readDocxState(state.doc);
      return shared.order.map((id) => [id, shared.blocks.get(id) ?? '']);
    },
    agent: async (request) => {
      const source = new SyncServiceSource(
        createSyncSocket(socketUrl),
        documentId
      );
      try {
        return await runDocxAgentRequest(source, request);
      } finally {
        source.cleanup();
      }
    },
    marks: () => {
      const state = session.state();
      return state.t === 'ready'
        ? Object.fromEntries(readCommentMarks(state.doc))
        : {};
    },
    handle,
  };
  onCleanup(() => Reflect.deleteProperty(window, 'docxFixture'));

  return (
    <main class="h-screen w-screen overflow-hidden bg-page font-sans text-ink">
      <Show
        when={(() => {
          const state = session.state();
          const engine = runtime();
          return engine && state.t === 'ready'
            ? { engine, doc: state.doc }
            : undefined;
        })()}
        keyed
        fallback={
          <div class="p-6 text-sm text-ink-muted" data-fixture-state>
            {session.state().t}
          </div>
        }
      >
        {(ready) => {
          watchFixtureThreads(ready.doc, setRoots);
          return (
            <DocxEditorView
              runtime={ready.engine}
              doc={ready.doc}
              canEdit={!readonly}
              canComment={() => true}
              author={shortName(user)}
              fileName="fixture.docx"
              peers={session.peers}
              displayName={shortName}
              onSelection={session.setSelection}
              subscribeRemote={session.onRemoteChange}
              commentRoots={roots}
              onReady={setHandle}
              onDownload={(bytes) => {
                const url = URL.createObjectURL(
                  new Blob([bytes.slice().buffer], {
                    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                  })
                );
                const anchor = document.createElement('a');
                anchor.href = url;
                anchor.download = 'fixture.docx';
                anchor.click();
                setTimeout(() => URL.revokeObjectURL(url), 1_000);
              }}
              onError={(error) => console.error('[docx-fixture]', error)}
              margin={(context) => (
                <DocxMarginLayout
                  comments={context.comments}
                  editorRoot={context.editorRoot}
                  margin={context.margin}
                  revision={context.revision}
                  canComment={() => true}
                  renderCard={(thread, isActive) => (
                    <FixtureThreadCard
                      thread={thread}
                      active={isActive()}
                      onPost={(text) =>
                        context.comments.commitDraft(async (draft) =>
                          postFixtureThread(ready.doc, draft.markId, text)
                        )
                      }
                      onCancel={() => context.comments.cancelDraft()}
                      onResolve={(resolved) =>
                        thread.root &&
                        resolveFixtureThread(
                          ready.doc,
                          thread.root.id,
                          resolved
                        )
                      }
                    />
                  )}
                />
              )}
            />
          );
        }}
      </Show>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('DOCX fixture root is missing.');
const dispose = render(() => <Fixture />, root);
import.meta.hot?.dispose(dispose);
