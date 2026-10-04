import '@fontsource-variable/inter';
import '../../../index.css';
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
import type { MessageListItem } from '@service-storage/messages';
import type { LoroDoc } from 'loro-crdt';
import { createSignal, For, onCleanup, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { readCommentMarks } from '../core/comment-marks';
import { readCollabState, sharedParagraphTexts } from '../core/docx-loro';
import { buildSeedSnapshot } from '../core/docx-seed';
import ComplexMsa from '../core/fixtures/complex-msa.docx?url';
import MutualNda from '../core/fixtures/mutual-nda.docx?url';
import type { LocatedThread } from '../primitives/create-docx-comments';
import type { DocxEditor } from '../primitives/create-docx-editor';
import { createDocxSession } from '../queries/docx-session';
import { DocxEditorView } from '../views/DocxEditorView';
import { DocxMarginLayout } from '../views/DocxMarginLayout';

declare global {
  interface Window {
    docxFixture?: {
      status: () => string;
      ready: () => boolean;
      /** Paragraph texts as this editor's engine has them. */
      paragraphs: () => Promise<string[]>;
      /** Paragraph texts as the shared document has them. */
      sharedParagraphs: () => string[];
      marks: () => Record<string, unknown>;
      editor: () => DocxEditor | undefined;
      /** Puts the caret in (or selects) the paragraph starting with `prefix`. */
      place: (
        prefix: string,
        where: 'start' | 'end' | 'all'
      ) => Promise<boolean>;
      /** Shared formatting of the paragraph starting with `prefix`. */
      sharedBlock: (
        prefix: string
      ) => { props: string; attrs: Record<string, string>[] } | null;
    };
  }
}

/** Fixture helpers that read the engine and the shared document. */
function helpers(
  editor: () => DocxEditor | undefined,
  doc: () => LoroDoc | undefined
) {
  return {
    place: async (prefix: string, where: 'start' | 'end' | 'all') => {
      const current = editor();
      if (!current) return false;
      const found = (await current.paragraphs()).find((p) =>
        p.text.replace(/\uFFFC/g, '').startsWith(prefix)
      );
      if (!found) return false;
      const end = { block: found.id, offset: found.text.length };
      const start = { block: found.id, offset: 0 };
      current.run([
        where === 'all'
          ? { op: 'select', anchor: start, focus: end }
          : {
              op: 'select',
              anchor: where === 'end' ? end : start,
              focus: where === 'end' ? end : start,
            },
      ]);
      await current.idle();
      document.querySelector<HTMLTextAreaElement>('[data-docx-input]')?.focus();
      return true;
    },
    sharedBlock: (prefix: string) => {
      const shared = doc();
      if (!shared) return null;
      const block = readCollabState(shared).blocks.find(
        (b) =>
          b.k === 'p' &&
          (b.t ?? [])
            .map((op) => ('insert' in op ? op.insert : ''))
            .join('')
            .replace(/\uFFFC/g, '')
            .startsWith(prefix)
      );
      if (!block) return null;
      return {
        props: block.x,
        attrs: (block.t ?? []).map((op) =>
          'insert' in op ? (op.attributes ?? {}) : {}
        ),
      };
    },
  };
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
/** A bundled fixture by name, or any document URL (`src`). */
const fixture =
  params.get('src') ??
  FIXTURES[params.get('fixture') ?? 'mutual-nda.docx'] ??
  MutualNda;

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
  const [editor, setEditor] = createSignal<DocxEditor>();
  const [roots, setRoots] = createSignal<MessageListItem[]>([]);

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
    buildSeed: buildSeedSnapshot,
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
    ready: () => !!editor(),
    paragraphs: async () =>
      (await editor()?.paragraphs())?.map((p) =>
        p.text.replace(/\uFFFC/g, '')
      ) ?? [],
    sharedParagraphs: () => {
      const state = session.state();
      return state.t === 'ready'
        ? sharedParagraphTexts(state.doc).map((t) => t.replace(/\uFFFC/g, ''))
        : [];
    },
    marks: () => {
      const state = session.state();
      return state.t === 'ready'
        ? Object.fromEntries(readCommentMarks(state.doc))
        : {};
    },
    editor,
    ...helpers(editor, () => {
      const state = session.state();
      return state.t === 'ready' ? state.doc : undefined;
    }),
  };
  onCleanup(() => Reflect.deleteProperty(window, 'docxFixture'));

  return (
    <main class="h-screen w-screen overflow-hidden bg-page font-sans text-ink">
      <Show
        when={(() => {
          const state = session.state();
          return state.t === 'ready' ? { doc: state.doc } : undefined;
        })()}
        keyed
        fallback={
          <div class="p-6 text-sm text-ink-muted" data-fixture-state>
            {(() => {
              const state = session.state();
              return state.t === 'error' ? `error: ${state.message}` : state.t;
            })()}
          </div>
        }
      >
        {(ready) => {
          watchFixtureThreads(ready.doc, setRoots);
          return (
            <DocxEditorView
              doc={ready.doc}
              canEdit={!readonly}
              canComment={() => true}
              fileName="fixture.docx"
              peers={session.peers}
              displayName={shortName}
              onSelection={session.setSelection}
              commentRoots={roots}
              onReady={setEditor}
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
                  geometry={context.geometry}
                  selectionTop={context.selectionTop}
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

/**
 * Local mode (`?local`): no sync service. The fixture document is seeded into
 * an in-page Loro document; `?local=pair` shows two editors whose documents
 * exchange updates directly, for trying collaboration without a server.
 */
function LocalFixture() {
  const pair = params.get('local') === 'pair';
  const [docs, setDocs] = createSignal<LoroDoc[]>();
  const [editor, setEditor] = createSignal<DocxEditor>();
  void (async () => {
    const original = new Uint8Array(await (await fetch(fixture)).arrayBuffer());
    const snapshot = await buildSeedSnapshot(original);
    const { LoroDoc } = await import('loro-crdt');
    const a = new LoroDoc();
    a.import(snapshot);
    if (!pair) {
      setDocs([a]);
      return;
    }
    const b = new LoroDoc();
    b.import(snapshot);
    a.subscribeLocalUpdates((u) => queueMicrotask(() => b.import(u)));
    b.subscribeLocalUpdates((u) => queueMicrotask(() => a.import(u)));
    setDocs([a, b]);
  })();
  window.docxFixture = {
    status: () => 'connected',
    ready: () => !!editor(),
    paragraphs: async () =>
      (await editor()?.paragraphs())?.map((p) =>
        p.text.replace(/\uFFFC/g, '')
      ) ?? [],
    sharedParagraphs: () => {
      const doc = docs()?.[0];
      return doc
        ? sharedParagraphTexts(doc).map((t) => t.replace(/\uFFFC/g, ''))
        : [];
    },
    marks: () => {
      const doc = docs()?.[0];
      return doc ? Object.fromEntries(readCommentMarks(doc)) : {};
    },
    editor,
    ...helpers(editor, () => docs()?.[0]),
  };
  return (
    <main class="flex h-screen w-screen overflow-hidden bg-page font-sans text-ink">
      <Show when={docs()} fallback={<div class="p-6">seeding…</div>}>
        {(list) => (
          <For each={list()}>
            {(doc, index) => (
              <div class="h-full min-w-0 flex-1 border-r border-edge">
                <DocxEditorView
                  doc={doc}
                  canEdit={!readonly}
                  canComment={() => true}
                  fileName="fixture.docx"
                  peers={() => []}
                  displayName={shortName}
                  onReady={index() === 0 ? setEditor : undefined}
                  onDownload={() => {}}
                  onError={(error) => console.error('[docx-fixture]', error)}
                />
              </div>
            )}
          </For>
        )}
      </Show>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('DOCX fixture root is missing.');
const dispose = render(
  () => (params.has('local') ? <LocalFixture /> : <Fixture />),
  root
);
import.meta.hot?.dispose(dispose);
