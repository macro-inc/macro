/**
 * The collaborative markdown editor (`CollabProvider`, sync engine, Loro undo
 * manager) over a large document and a sync source that accepts every update
 * locally, so undo can be timed without a backend.
 */

import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
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
import {
  $createRangeSelection,
  $getRoot,
  $isElementNode,
  $setSelection,
  type LexicalEditor,
} from 'lexical';
import { okAsync } from 'neverthrow';
import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import { render } from 'solid-js/web';
import type { MarkdownEditorErrors } from '../../constants';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '../../context/LexicalWrapperContext';
import { registerMarkdownEditing } from '../../editing/registerMarkdownEditing';
import { editorFocusSignal } from '../../utils';
import { CollabProvider } from '../CollabProvider';

declare global {
  interface Window {
    largeUndo?: {
      ready: () => boolean;
      paragraphs: () => number;
      text: () => string;
      /** Puts the caret at the end of the top-level block at `index`. */
      placeAtEnd: (index: number) => void;
      /** Selects the top-level blocks from `first` through `last`. */
      selectBlocks: (first: number, last: number) => void;
      /** Times the next keydown until the editor's text equals `expected`. */
      armUndoTimer: (expected: string) => void;
      /** The ms the armed timer measured. */
      undoTime: () => Promise<number>;
    };
  }
}

const PARAGRAPH =
  'Call me Ishmael. Some years ago, never mind how long precisely, having little or no money in my purse, and nothing particular to interest me on shore, I thought I would sail about a little and see the watery part of the world. It is a way I have of driving off the spleen and regulating the circulation.';

function largeMarkdown(paragraphs: number): string {
  return Array.from(
    { length: paragraphs },
    (_, i) => `${i % 50 === 0 ? '## Chapter ' : ''}${i} ${PARAGRAPH}`
  ).join('\n\n');
}

function Fixture() {
  const paragraphs = Number(
    new URLSearchParams(location.search).get('paragraphs') ?? '2000'
  );
  const documentId = 'large-undo';
  const loroManager = createLoroManager(MARKDOWN_LORO_SCHEMA, { documentId });
  const source: LiveSyncSource = {
    documentId,
    status: () => SyncSourceStatus.Connected,
    listen: (_listener: (event: SyncSourceEvent) => void) => () => {},
    pushUpdate: async () => true,
    pushAwareness: () => {},
    registerPeerId: () => {},
    requestUpdatesSince: () => okAsync(new Uint8Array()),
    requestSnapshot: () => okAsync(new Uint8Array()),
    reconnect: () => {},
    cleanup: () => {},
  };
  const [syncSource, setSyncSource] = createSignal<LiveSyncSource>();
  const [ready, setReady] = createSignal(false);
  let editor: LexicalEditor | undefined;
  let undoTime: Promise<number> | undefined;

  const connect = async () => {
    const snapshot = await markdownToLoroSnapshot(largeMarkdown(paragraphs));
    if (!snapshot) throw new Error('no snapshot');
    await loroManager.ingest({ kind: 'dss', snapshot });
    setSyncSource(source);
  };
  fireAndForget(connect(), 'large-undo-fixture');

  window.largeUndo = {
    ready,
    paragraphs: () =>
      editor?.getEditorState().read(() => $getRoot().getChildrenSize()) ?? 0,
    text: () =>
      editor?.getEditorState().read(() => $getRoot().getTextContent()) ?? '',
    placeAtEnd: (index) => {
      editor?.update(
        () => {
          const block = $getRoot().getChildAtIndex(index);
          if ($isElementNode(block)) block.selectEnd();
        },
        { discrete: true }
      );
      editor?.focus();
    },
    selectBlocks: (first, last) => {
      editor?.update(
        () => {
          const root = $getRoot();
          const start = root.getChildAtIndex(first);
          const end = root.getChildAtIndex(last);
          if (!$isElementNode(start) || !$isElementNode(end)) return;
          const selection = $createRangeSelection();
          selection.anchor.set(start.getKey(), 0, 'element');
          selection.focus.set(end.getKey(), end.getChildrenSize(), 'element');
          $setSelection(selection);
        },
        { discrete: true }
      );
      editor?.focus();
    },
    armUndoTimer: (expected) => {
      undoTime = new Promise((resolve) => {
        const target = editor;
        if (!target) throw new Error('no editor');
        let start = 0;
        window.addEventListener(
          'keydown',
          () => {
            start = performance.now();
          },
          { capture: true, once: true }
        );
        const unregister = target.registerUpdateListener(({ editorState }) => {
          if (start === 0) return;
          const text = editorState.read(() => $getRoot().getTextContent());
          if (text !== expected) return;
          unregister();
          // Let the follow-up updates queued by the undo run before stopping.
          setTimeout(() => resolve(performance.now() - start));
        });
      });
    },
    undoTime: () => undoTime ?? Promise.reject(new Error('timer not armed')),
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
  const isContentEditable = () => editorReady() && !editorError();
  const lexicalWrapper = createLexicalWrapper({
    type: 'markdown-sync',
    namespace: 'large-undo',
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
          canEdit={() => true}
          canComment={() => false}
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
