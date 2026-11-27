/**
 * The collaborative markdown editor (`CollabProvider`, WAL, sync engine) over
 * a real sync-service socket to a local room, with the md block's sync banner
 * rendered from the provider's health, so tests can stall or drop the
 * connection and watch what the viewer is told.
 */

import '@app/index.css';
import { CollabSyncMessage } from '@app/features/block-md/component/CollabSyncMessage';
import { applyTheme } from '@app/features/theme/utils/themeUtils';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { UserContextProvider } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { onElementConnect } from '@core/util/onElementConnect';
import { createLoroManager } from '@macro-inc/collaboration/collab/manager';
import {
  BrowserWALStore,
  LORO_WAL_DB_NAME,
} from '@macro-inc/collaboration/collab/wal';
import { createSyncSocket } from '@macro-inc/collaboration/sync-service/socket';
import {
  mapToSyncStatus,
  SyncServiceSource,
} from '@macro-inc/collaboration/sync-service/source';
import { createWebsocketStateSignal } from '@macro-inc/collaboration/websocket/solid/state-signal';
import { createPeerIdValidator } from '@macro-inc/lexical-core';
import { MARKDOWN_LORO_SCHEMA } from '@macro-inc/lexical-core/markdown-loro-schema';
import { markdownToLoroSnapshot } from '@macro-inc/lexical-core/markdown-loro-snapshot';
import { authKeys } from '@queries/auth/keys';
import { queryClient } from '@queries/client';
import { MemoryRouter, Route } from '@solidjs/router';
import { QueryClientProvider } from '@tanstack/solid-query';
import { DragDropProvider } from '@thisbeyond/solid-dnd';
import { $getRoot, $isElementNode, type LexicalEditor } from 'lexical';
import {
  createEffect,
  createResource,
  createSignal,
  getOwner,
  onCleanup,
  runWithOwner,
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
import type { CollabSyncHealth } from '../syncHealth';

declare global {
  interface Window {
    syncBannerFixture?: {
      ready: () => boolean;
      placeAtEnd: () => void;
      pendingWrites: () => Promise<number>;
    };
  }
}

queryClient.setQueryData(authKeys.userInfo.queryKey, {
  authenticated: true,
  email: 'fixture@example.invalid',
});

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
  const owner = getOwner();

  const [liveSource] = createResource(async () => {
    const seed = await markdownToLoroSnapshot('Shared paragraph');
    if (!seed) throw new Error('Missing fixture snapshot');
    const seeded = await fetch(`http://127.0.0.1:${port}/seed`, {
      method: 'POST',
      body: new Uint8Array(seed),
    });
    if (!seeded.ok) throw new Error('Unable to seed fixture room');
    // As the app builds it: status is a signal the banner can follow.
    const ws = createSyncSocket(`ws://127.0.0.1:${port}/${peer}`);
    const state = runWithOwner(owner, () => createWebsocketStateSignal(ws));
    if (!state) throw new Error('Fixture lost its owner');
    const source = new SyncServiceSource(ws, documentId, {
      status: () => mapToSyncStatus(state()),
    });
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

  window.syncBannerFixture = {
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
    pendingWrites: async () =>
      (await wal.getAll()).filter((entry) => !entry.delivered).length,
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
  const [syncHealth, setSyncHealth] = createSignal<CollabSyncHealth>();
  const isContentEditable = () => editorReady() && !editorError();
  const lexicalWrapper = createLexicalWrapper({
    type: 'markdown-sync',
    namespace: 'sync-banner-regression',
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
      <div class="mx-auto max-w-3xl p-4">
        {/* Rendered as the md block's MarkdownEditor renders it. */}
        <Show when={syncHealth()?.problem()}>
          {(problem) => (
            <CollabSyncMessage
              problem={problem()}
              onRetry={() => syncHealth()?.retry()}
            />
          )}
        </Show>
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
            onSyncHealth={setSyncHealth}
          />
        </div>
      </div>
    </LexicalWrapperContext.Provider>
  );
}

document.documentElement.dataset.touchDevice = String(isTouchDevice());
applyTheme(
  new URLSearchParams(location.search).get('theme') === 'light'
    ? 'Macro Light'
    : 'Macro Dark'
);
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
