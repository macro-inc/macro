import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { CollabProvider } from '@core/component/LexicalMarkdown/collaboration/CollabProvider';
import type { MarkdownEditorErrors } from '@core/component/LexicalMarkdown/constants';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import { registerMarkdownEditing } from '@core/component/LexicalMarkdown/editing/registerMarkdownEditing';
import {
  COMMIT_COMMENT_MARK_COMMAND,
  CREATE_DRAFT_COMMENT_COMMAND,
  commentPlugin,
  DELETE_COMMENT_COMMAND,
  DISCARD_DRAFT_COMMENT_COMMAND,
} from '@core/component/LexicalMarkdown/plugins/comments/commentPlugin';
import { editorFocusSignal } from '@core/component/LexicalMarkdown/utils';
import { UserContextProvider } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { onElementConnect } from '@core/util/onElementConnect';
import { createLoroManager } from '@macro-inc/collaboration/collab/manager';
import {
  type LiveSyncSource,
  type SyncSourceEvent,
  SyncSourceStatus,
} from '@macro-inc/collaboration/collab/source';
import { createPeerIdValidator } from '@macro-inc/lexical-core';
import { MARKDOWN_LORO_SCHEMA } from '@macro-inc/lexical-core/markdown-loro-schema';
import { markdownToLoroSnapshot } from '@macro-inc/lexical-core/markdown-loro-snapshot';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { DragDropProvider } from '@thisbeyond/solid-dnd';
import { $getRoot, type LexicalEditor } from 'lexical';
import { okAsync } from 'neverthrow';
import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { CommentButton } from '../../component/CommentButton';
import {
  createLocalCommentDraft,
  type DraftPublication,
} from '../LocalCommentDraft';

declare global {
  interface Window {
    commentCollab?: {
      ready: () => boolean;
      state: () => unknown;
      text: () => string;
      remoteEdit: () => Promise<void>;
      version: () => string;
    };
  }
}

const MARKDOWN =
  'The shared directory contains useful notes for every reader.\n\nA second paragraph offers another place for comments.';

function Fixture() {
  const documentId = crypto.randomUUID();
  const loroManager = createLoroManager(MARKDOWN_LORO_SCHEMA, { documentId });
  const server = createLoroManager(MARKDOWN_LORO_SCHEMA, { documentId });
  const listeners = new Set<(event: SyncSourceEvent) => void>();
  const source: LiveSyncSource = {
    documentId,
    status: () => SyncSourceStatus.Connected,
    listen: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    pushUpdate: async (updates) => {
      if (new URLSearchParams(location.search).has('reject')) return false;
      for (const update of updates) {
        if (server.importUpdate(update).isErr()) return false;
      }
      return true;
    },
    pushAwareness: () => {},
    registerPeerId: () => {},
    requestUpdatesSince: (from) =>
      okAsync(server.doc.export({ mode: 'update', from })),
    requestSnapshot: () =>
      okAsync(
        server.doc.export({
          mode: 'shallow-snapshot',
          frontiers: server.doc.oplogFrontiers(),
        })
      ),
    reconnect: () => {},
    cleanup: () => {},
  };
  const [syncSource, setSyncSource] = createSignal<LiveSyncSource>();
  const [ready, setReady] = createSignal(false);
  let editor: LexicalEditor | undefined;

  const connect = async () => {
    const snapshot = await markdownToLoroSnapshot(MARKDOWN);
    if (!snapshot) throw new Error('no snapshot');
    await server.ingest({ kind: 'dss', snapshot });
    await loroManager.ingest({ kind: 'dss', snapshot });
    setSyncSource(source);
  };
  fireAndForget(connect(), 'comment-collab-fixture');

  window.commentCollab = {
    ready,
    version: () => JSON.stringify(loroManager.doc.oplogVersion().toJSON()),
    remoteEdit: async () => {
      const version = server.doc.oplogVersion();
      const state = structuredClone(server.state!.state);
      const paragraph = state.root.children[0];
      const text = paragraph.children.find((node: { text?: string }) =>
        node.text?.includes('notes')
      );
      if (!text) throw new Error('Missing remote text');
      const missed = new URLSearchParams(location.search).has('missed-update');
      text.text = text.text.replace('notes', missed ? 'notes!!' : 'notes!');
      const result = await server.syncToLoro(state);
      if (result.isErr()) throw new Error('Remote edit failed');
      if (missed) return;
      const update = server.doc.export({ mode: 'update', from: version });
      for (const listener of listeners) listener({ type: 'update', update });
    },
    state: () => loroManager.doc.toJSON(),
    text: () => editor?.read(() => $getRoot().getTextContent()) ?? '',
  };

  return (
    <main class="p-4 text-ink bg-page">
      <Show when={syncSource()}>
        <Editor
          documentId={documentId}
          loroManager={loroManager}
          syncSource={syncSource}
          onEditor={(e) => {
            editor = e;
          }}
          onReady={() => setReady(true)}
        />
      </Show>
    </main>
  );
}

/** The editor `CollabMarkdownEditor` builds, minus menus and overlays. */
function Editor(props: {
  documentId: string;
  loroManager: ReturnType<
    typeof createLoroManager<typeof MARKDOWN_LORO_SCHEMA>
  >;
  syncSource: () => LiveSyncSource | undefined;
  onEditor: (editor: LexicalEditor) => void;
  onReady: () => void;
}) {
  const [editorReady, setEditorReady] = createSignal(false);
  const [editorError, setEditorError] =
    createSignal<MarkdownEditorErrors | null>(null);
  const readonly = new URLSearchParams(location.search).has('readonly');
  const isContentEditable = () => !readonly && editorReady() && !editorError();
  const lexicalWrapper = createLexicalWrapper({
    type: 'markdown-sync',
    namespace: 'comment-collab',
    isInteractable: isContentEditable,
    withIds: true,
  });
  const { editor, plugins, cleanup } = lexicalWrapper;
  onCleanup(cleanup);
  props.onEditor(editor);
  const [editorFocus, setEditorFocus] = createSignal(false);
  editorFocusSignal(editor, setEditorFocus);
  const peerId = () => props.loroManager.peerIdStr;
  const [draft, setDraft] = createSignal<string>();
  const [publication, setPublication] = createSignal<DraftPublication>();
  const [result, setResult] = createSignal('');
  const localDraft = createLocalCommentDraft({
    userId: () => 'fixture-user',
    hasPostedComment: async () => false,
    interactable: isContentEditable,
    editor,
    manager: props.loroManager,
    mapping: lexicalWrapper.mapping,
    source: props.syncSource,
    add: (id, _anchor, publication) => {
      setDraft(id);
      setPublication(publication);
    },
    remove: () => {
      setDraft();
      setPublication();
    },
  });
  onCleanup(
    commentPlugin({
      peerId,
      draft: localDraft,
      ops: {
        add: (id, _node, _element, _saved, isDraft, local) => {
          if (isDraft && local) setDraft(id);
        },
        remove: (id, _key, last) => {
          if (last && draft() === id) setDraft(undefined);
        },
        init: () => {},
        setActiveIds: () => {},
      },
    })(editor)
  );
  plugins
    .richText()
    .list()
    .markdownShortcuts()
    .delete()
    .history(400, props.loroManager);
  registerMarkdownEditing({
    lexicalWrapper,
    isContentEditable,
    peerIdValidator: createPeerIdValidator(peerId, true),
    source: { id: props.documentId, trackMentions: false },
    onVersionError: setEditorError,
    peerId,
  });
  createEffect(() => editor.setEditable(isContentEditable()));
  createEffect(() => {
    if (editorReady()) props.onReady();
  });
  let container!: HTMLDivElement;
  return (
    <LexicalWrapperContext.Provider value={lexicalWrapper}>
      <div class="relative border border-edge-muted p-2" ref={container}>
        <div
          ref={(el) => onElementConnect(el, () => editor.setRootElement(el))}
          contentEditable={isContentEditable()}
          role="textbox"
          aria-label="Document"
          aria-multiline="true"
          class="w-full outline-none"
        />
        <CommentButton
          onClick={() =>
            editor.dispatchCommand(CREATE_DRAFT_COMMENT_COMMAND, undefined)
          }
        />
        <button
          onClick={async () => {
            setResult('');
            const id = draft();
            const accepted = await publication()?.publish();
            setResult(accepted ? 'accepted' : 'rejected');
            if (id && accepted)
              editor.dispatchCommand(COMMIT_COMMENT_MARK_COMMAND, {
                markId: id,
              });
          }}
        >
          Post comment
        </button>
        <button
          onClick={() => {
            const id = draft();
            if (id) editor.dispatchCommand(DELETE_COMMENT_COMMAND, [id, false]);
            editor.dispatchCommand(DISCARD_DRAFT_COMMENT_COMMAND, undefined);
            setDraft(undefined);
          }}
        >
          Cancel draft
        </button>
        <output data-testid="draft">{draft()}</output>
        <output data-testid="result">{result()}</output>
        <localDraft.Highlight />
        <CollabProvider
          editor={editor}
          pluginManager={plugins}
          editorContainerRef={container}
          highlightLayerRef={container}
          mappings={lexicalWrapper.mapping!}
          editorFocus={editorFocus}
          setEditorReady={setEditorReady}
          setEditorError={setEditorError}
          loroManager={props.loroManager}
          syncSource={props.syncSource}
          sourceReady={() => true}
          canEdit={() => !readonly}
          canComment={() => true}
          editorError={editorError}
        />
      </div>
    </LexicalWrapperContext.Provider>
  );
}

const client = new QueryClient();
render(
  () => (
    <AnalyticsContextProvider>
      <PosthogProvider>
        <QueryClientProvider client={client}>
          <UserContextProvider>
            <DragDropProvider>
              <Fixture />
            </DragDropProvider>
          </UserContextProvider>
        </QueryClientProvider>
      </PosthogProvider>
    </AnalyticsContextProvider>
  ),
  document.getElementById('root')!
);
