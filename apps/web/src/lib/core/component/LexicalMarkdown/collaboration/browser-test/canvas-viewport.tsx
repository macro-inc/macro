import '@app/index.css';

import type { CanvasView } from '@app/features/block-canvas/core/view';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { UserContextProvider } from '@core/context/user';
import { onElementConnect } from '@core/util/onElementConnect';
import { Mirror } from '@loro-mirror/core';
import { createLoroManager } from '@macro-inc/collaboration/collab/manager';
import {
  BrowserWALStore,
  LORO_WAL_DB_NAME,
} from '@macro-inc/collaboration/collab/wal';
import { createSyncSocket } from '@macro-inc/collaboration/sync-service/socket';
import { SyncServiceSource } from '@macro-inc/collaboration/sync-service/source';
import { createPeerIdValidator } from '@macro-inc/lexical-core';
import { MARKDOWN_LORO_SCHEMA } from '@macro-inc/lexical-core/markdown-loro-schema';
import { markdownToLoroSnapshot } from '@macro-inc/lexical-core/markdown-loro-snapshot';
import { authKeys } from '@queries/auth/keys';
import { queryClient } from '@queries/client';
import { previewKeys } from '@queries/preview/keys';
import type { PreviewItem } from '@queries/preview/types';
import { MemoryRouter, Route } from '@solidjs/router';
import { QueryClientProvider } from '@tanstack/solid-query';
import { DragDropProvider } from '@thisbeyond/solid-dnd';
import { $getRoot, $isElementNode, type LexicalEditor } from 'lexical';
import {
  createEffect,
  createResource,
  createSignal,
  onCleanup,
  Show,
} from 'solid-js';
import { render } from 'solid-js/web';
import { DecoratorRenderer } from '../../component/core/DecoratorRenderer';
import type { MarkdownEditorErrors } from '../../constants';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '../../context/LexicalWrapperContext';
import { MarkdownHostContext } from '../../context/MarkdownHostContext';
import { registerMarkdownEditing } from '../../editing/registerMarkdownEditing';
import { initializeLexical } from '../../init';
import { editorFocusSignal } from '../../utils';
import { CollabProvider } from '../CollabProvider';
import { flushCollaboration } from '../flush';

declare global {
  interface Window {
    canvasViewportFixture?: {
      ready: () => boolean;
      placeAtEnd: () => void;
      flush: () => Promise<boolean>;
      pendingWrites: () => Promise<number>;
      writeLegacyView: (view: CanvasView) => Promise<boolean>;
    };
  }
}

const cardId = '00000000-0000-4000-8000-000000000002';
queryClient.setQueryData(authKeys.userInfo.queryKey, {
  authenticated: true,
  email: 'fixture@example.invalid',
});
queryClient.setQueryData(previewKeys.item(cardId).queryKey, {
  id: cardId,
  type: 'document',
  fileType: 'canvas',
  name: 'Synthetic canvas',
  rawName: 'Synthetic canvas',
  owner: 'macro|fixture@example.invalid',
  loading: false,
  documentMetadata: { properties: [], canEdit: true },
  access: 'access',
} satisfies PreviewItem);

function Fixture() {
  const params = new URLSearchParams(location.search);
  const documentId = params.get('id');
  const port = params.get('port');
  const peer = params.get('peer');
  if (!documentId || !port || !peer)
    throw new Error('Missing fixture parameters');

  const loroManager = createLoroManager(MARKDOWN_LORO_SCHEMA, { documentId });
  const wal = new BrowserWALStore<Uint8Array>(LORO_WAL_DB_NAME, documentId);
  const [ready, setReady] = createSignal(false);
  let editor: LexicalEditor | undefined;
  let socket: SyncServiceSource | undefined;
  onCleanup(() => socket?.cleanup());

  const [liveSource] = createResource(async () => {
    const seed = await markdownToLoroSnapshot(
      '<m-document-card>{"documentId":"00000000-0000-4000-8000-000000000002","blockName":"canvas","documentName":"Synthetic canvas","previewData":{"view":{"x":24,"y":48,"scale":125}}}</m-document-card>\n\nShared paragraph'
    );
    if (!seed) throw new Error('Missing fixture snapshot');
    const seeded = await fetch(`http://127.0.0.1:${port}/seed`, {
      method: 'POST',
      body: new Uint8Array(seed),
    });
    if (!seeded.ok) throw new Error('Unable to seed fixture room');
    const source = new SyncServiceSource(
      createSyncSocket(`ws://127.0.0.1:${port}/${peer}`),
      documentId
    );
    socket = source;
    const initial = await source.doInitialSync();
    if (initial.isErr()) throw new Error('Initial fixture sync failed');
    const result = await loroManager.ingest({
      kind: 'dss',
      snapshot: initial.value.snapshot,
    });
    if (!result) throw new Error('Unable to import fixture markdown');
    return source;
  });

  window.canvasViewportFixture = {
    ready,
    placeAtEnd: () => {
      editor?.update(
        () => {
          const paragraph = $getRoot().getLastChild();
          if ($isElementNode(paragraph)) paragraph.selectEnd();
        },
        { discrete: true }
      );
      editor?.focus();
    },
    flush: () => {
      if (!editor) throw new Error('Editor is not mounted');
      return flushCollaboration(editor);
    },
    pendingWrites: async () =>
      (await wal.getAll()).filter((entry) => !entry.delivered).length,
    async writeLegacyView(view) {
      // The old writer mirrored its Lexical state without preserving the
      // stored viewport. Run that same Mirror write against a separate fork.
      const source = liveSource();
      if (!source) throw new Error('Missing transport');
      const doc = loroManager.doc.fork();
      const mirror = new Mirror({ doc, schema: MARKDOWN_LORO_SCHEMA });
      try {
        const version = doc.oplogVersion();
        mirror.setState((draft) => {
          const card = draft.root.children?.[0];
          if (!card || card.type !== 'document-card') {
            throw new Error('Missing legacy canvas card');
          }
          card.previewData = { view };
        });
        doc.commit();
        return await source.pushUpdate([
          doc.export({ mode: 'update', from: version }),
        ]);
      } finally {
        mirror.dispose();
        doc.free();
      }
    },
  };

  return (
    <MarkdownHostContext.Provider value="md">
      <Show when={liveSource()} keyed>
        {(source) => (
          <Editor
            documentId={documentId}
            loroManager={loroManager}
            source={source}
            onEditor={(value) => {
              editor = value;
            }}
            onReady={() => setReady(true)}
          />
        )}
      </Show>
    </MarkdownHostContext.Provider>
  );
}

function Editor(props: {
  documentId: string;
  loroManager: ReturnType<
    typeof createLoroManager<typeof MARKDOWN_LORO_SCHEMA>
  >;
  source: SyncServiceSource;
  onEditor: (editor: LexicalEditor) => void;
  onReady: () => void;
}) {
  const [editorReady, setEditorReady] = createSignal(false);
  const [editorError, setEditorError] =
    createSignal<MarkdownEditorErrors | null>(null);
  const isContentEditable = () => editorReady() && !editorError();
  const lexicalWrapper = createLexicalWrapper({
    type: 'markdown-sync',
    namespace: 'canvas-viewport-regression',
    isInteractable: isContentEditable,
    withIds: true,
  });
  const { editor, plugins, cleanup } = lexicalWrapper;
  onCleanup(cleanup);
  props.onEditor(editor);
  const [editorFocus, setEditorFocus] = createSignal(false);
  editorFocusSignal(editor, setEditorFocus);
  const peerId = () => props.loroManager.peerIdStr;
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
          aria-multiline="true"
          class="w-full outline-none"
        />
        <DecoratorRenderer editor={editor} />
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
          syncSource={() => props.source}
          sourceReady={() => true}
          canEdit={() => true}
          editorError={editorError}
        />
      </div>
    </LexicalWrapperContext.Provider>
  );
}

initializeLexical();
render(
  () => (
    <MemoryRouter>
      <Route
        path="*"
        component={() => (
          <AnalyticsContextProvider>
            <PosthogProvider>
              <QueryClientProvider client={queryClient}>
                <UserContextProvider>
                  <DragDropProvider>
                    <Fixture />
                  </DragDropProvider>
                </UserContextProvider>
              </QueryClientProvider>
            </PosthogProvider>
          </AnalyticsContextProvider>
        )}
      />
    </MemoryRouter>
  ),
  document.getElementById('root')!
);
