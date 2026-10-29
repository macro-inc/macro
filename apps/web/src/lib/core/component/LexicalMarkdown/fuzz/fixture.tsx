/**
 * One fuzz peer: the real collaborative markdown editor (`CollabMarkdownEditor`,
 * so the real CollabProvider, sync engine, WAL, reconcile, and cursors) over a
 * `LiveSyncSource` whose other end is the Playwright process. Every byte this
 * peer sends or receives goes through the `FuzzWire` bindings the test exposes
 * and `LexFuzzApi.deliver`, so the test decides when, and in what order, each
 * peer sees each update.
 *
 * `window.lexFuzz` also reads this peer's state back for the oracles.
 */

import '../../../../../index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import type { CollabSurfaceLoroManager } from '@core/collab-surface/createCollabSurface';
import { UserContextProvider } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { onElementConnect } from '@core/util/onElementConnect';
import { $isCodeNode } from '@lexical/code';
import { createHeadlessEditor } from '@lexical/headless';
import {
  $isListItemNode,
  $isListNode,
  type ListItemNode,
  type ListNode,
} from '@lexical/list';
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
} from '@lexical/markdown';
import { $isHeadingNode, $isQuoteNode } from '@lexical/rich-text';
import { $findMatchingParent } from '@lexical/utils';
import { createLoroManager } from '@macro-inc/collaboration/collab/manager';
import {
  type LiveSyncSource,
  SyncError,
  type SyncSourceEvent,
  SyncSourceStatus,
} from '@macro-inc/collaboration/collab/source';
import {
  $getId,
  $isCustomCodeNode,
  createPeerIdValidator,
  INTERNAL_TRANSFORMERS,
  NodeReplacements,
  SupportedNodeTypes,
} from '@macro-inc/lexical-core';
import { MARKDOWN_LORO_SCHEMA } from '@macro-inc/lexical-core/markdown-loro-schema';
import { markdownToLoroSnapshot } from '@macro-inc/lexical-core/markdown-loro-snapshot';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { DragDropProvider } from '@thisbeyond/solid-dnd';
import {
  $getRoot,
  $getSelection,
  $isElementNode,
  $isParagraphNode,
  $isRangeSelection,
  type ElementNode,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical';
import type { VersionVector } from 'loro-crdt';
import { okAsync, ResultAsync } from 'neverthrow';
import {
  type Accessor,
  createEffect,
  createSignal,
  onCleanup,
  Show,
} from 'solid-js';
import { render } from 'solid-js/web';
import { match } from 'ts-pattern';
import { CollabProvider } from '../collaboration/CollabProvider';
import type { MarkdownEditorErrors } from '../constants';
import {
  createLexicalWrapper,
  isWrapperWithIds,
  LexicalWrapperContext,
} from '../context/LexicalWrapperContext';
import { registerMarkdownEditing } from '../editing/registerMarkdownEditing';
import {
  editorFocusSignal,
  editorStateAsMarkdown,
  loroSyncState,
} from '../utils';
import type {
  FuzzBlock,
  FuzzCaret,
  FuzzWindow,
  FuzzWire,
  LexFuzzApi,
} from './bridge';

const fuzzWindow: FuzzWindow = window;

/** The test's bindings, which it exposes before the page loads. */
function wire(): FuzzWire {
  const { fuzzConnect, fuzzPush, fuzzAwareness, fuzzSince } = fuzzWindow;
  if (!fuzzConnect || !fuzzPush || !fuzzAwareness || !fuzzSince)
    throw new Error('the fuzz test did not expose its bindings');
  return { fuzzConnect, fuzzPush, fuzzAwareness, fuzzSince };
}

const toBase64 = (bytes: Uint8Array) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};
const fromBase64 = (text: string) =>
  Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

const errors: string[] = [];
/** The last updates' tags and dirty counts, to see what loops. */
const updateLog: string[] = [];
const originalError = console.error;
console.error = (...args: unknown[]) => {
  errors.push(
    (String(args[0]).includes('endlessly')
      ? `${updateLog.slice(-120).join(' | ')}\n`
      : '') +
      args
        .map((a) =>
          a instanceof Error ? `${a.message}\n${a.stack}` : String(a)
        )
        .join(' ')
  );
  originalError(...args);
};
const describe = (error: unknown) =>
  error instanceof Error ? `${error.message}\n${error.stack}` : String(error);
window.addEventListener('error', (e) =>
  errors.push(`uncaught: ${describe(e.error)}`)
);
window.addEventListener('unhandledrejection', (e) =>
  errors.push(`unhandled rejection: ${describe(e.reason)}`)
);

/** Starts `work`, recording a rejection where the oracles will see it. */
function background(work: Promise<unknown>): void {
  const settle = async () => {
    try {
      await work;
    } catch (error) {
      errors.push(`background: ${describe(error)}`);
    }
  };
  fireAndForget(settle(), 'lexical-fuzz');
}

const headless = () =>
  createHeadlessEditor({
    nodes: [...SupportedNodeTypes, ...NodeReplacements],
    onError: (e) => {
      throw e;
    },
  });

/** As lexical-service's `toMarkdownText(state, 'internal')`. */
function stateToMarkdown(json: string): string {
  const editor = headless();
  editor.setEditorState(editor.parseEditorState(json));
  return editor.read(() => $convertToMarkdownString(INTERNAL_TRANSFORMERS));
}

function markdownRoundTrip(markdown: string): string {
  const editor = headless();
  editor.update(
    () => $convertFromMarkdownString(markdown, INTERNAL_TRANSFORMERS),
    { discrete: true }
  );
  return editor.read(() => $convertToMarkdownString(INTERNAL_TRANSFORMERS));
}

const listKind = (list: ListNode) =>
  match(list.getListType())
    .with('number', () => 'ol')
    .with('check', () => 'check')
    .with('bullet', () => 'ul')
    .exhaustive();

/** The oracle's name for a block's type. */
function $blockType(block: ElementNode): string {
  if ($isListItemNode(block)) {
    const list = block.getParent();
    return $isListNode(list)
      ? listKind(list)
      : `listitem in ${list?.getType()}`;
  }
  if ($isHeadingNode(block)) return block.getTag();
  if ($isQuoteNode(block)) return 'quote';
  if ($isCodeNode(block) || $isCustomCodeNode(block)) return 'code';
  if ($isParagraphNode(block)) return 'p';
  return block.getType();
}

function $listItems(list: ListNode, indent: number): FuzzBlock[] {
  return list.getChildren().flatMap((item) => {
    if (!$isListItemNode(item))
      return [
        {
          type: `${listKind(list)}>${item.getType()}`,
          text: item.getTextContent(),
        },
      ];
    const nested = item.getChildren().find($isListNode);
    if (nested) return $listItems(nested, indent + 1);
    return [$listItem(item, indent)];
  });
}

function $listItem(item: ListItemNode, indent: number): FuzzBlock {
  const block: FuzzBlock = {
    type: $blockType(item),
    text: item.getTextContent(),
  };
  return indent > 0 ? { ...block, indent } : block;
}

function $blocks(node: LexicalNode): FuzzBlock[] {
  if ($isListNode(node)) return $listItems(node, 0);
  return [
    {
      type: $isElementNode(node) ? $blockType(node) : node.getType(),
      text: node.getTextContent(),
    },
  ];
}

function $caret(): FuzzCaret | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return null;
  const anchor = selection.anchor.getNode();
  const block = $findMatchingParent(
    anchor,
    (node) =>
      $isListItemNode(node) ||
      $isHeadingNode(node) ||
      $isQuoteNode(node) ||
      $isCodeNode(node) ||
      $isCustomCodeNode(node) ||
      $isParagraphNode(node)
  );
  if (!$isElementNode(block)) return null;
  const offset = selection.anchor.offset;
  let before = $isElementNode(anchor)
    ? anchor
        .getChildren()
        .slice(0, offset)
        .map((child) => child.getTextContent())
        .join('')
    : anchor.getTextContent().slice(0, offset);
  for (let node = anchor; node !== block; node = node.getParentOrThrow())
    before =
      node
        .getPreviousSiblings()
        .map((sibling) => sibling.getTextContent())
        .join('') + before;
  return {
    collapsed: selection.isCollapsed(),
    blockType: $blockType(block),
    text: block.getTextContent(),
    before,
  };
}

function $invariants(): string[] {
  const problems: string[] = [];
  const root = $getRoot();
  if (root.getChildrenSize() === 0) problems.push('root has no children');
  for (const child of root.getChildren())
    if (child.isInline())
      problems.push(`inline ${child.getType()} directly under root`);
  const ids = new Map<string, string>();
  const walk = (node: LexicalNode, path: string) => {
    if (node !== root) {
      const id = $getId(node);
      const seen = id === null ? undefined : ids.get(id);
      if (id === null) problems.push(`no id at ${path} (${node.getType()})`);
      else if (seen) problems.push(`duplicate id ${id} at ${path} and ${seen}`);
      else ids.set(id, path);
    }
    if ($isListNode(node))
      for (const child of node.getChildren())
        if (!$isListItemNode(child))
          problems.push(`list holds ${child.getType()}`);
    if ($isListItemNode(node) && !$isListNode(node.getParent()))
      problems.push(`listitem under ${node.getParent()?.getType()}`);
    if ($isElementNode(node))
      node.getChildren().forEach((child, i) => walk(child, `${path}/${i}`));
  };
  walk(root, 'root');
  return problems;
}

function Peer() {
  const documentId = new URLSearchParams(location.search).get('doc');
  if (!documentId) throw new Error('the fuzz page needs ?doc=<id>');
  const loroManager = createLoroManager(MARKDOWN_LORO_SCHEMA, { documentId });
  const server = wire();
  const listeners = new Set<(event: SyncSourceEvent) => void>();
  const source: LiveSyncSource = {
    documentId,
    status: () => SyncSourceStatus.Connected,
    listen: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    pushUpdate: async (updates) => {
      const acks = await Promise.all(
        updates.map((update) => server.fuzzPush(toBase64(update)))
      );
      return acks.every(Boolean);
    },
    pushAwareness: (value) => {
      background(server.fuzzAwareness(toBase64(value)));
    },
    registerPeerId: () => {},
    requestUpdatesSince: (version: VersionVector) =>
      ResultAsync.fromPromise(
        server.fuzzSince(toBase64(version.encode())),
        (error): SyncError => SyncError.unknown(new Error(String(error)))
      ).map(fromBase64),
    requestSnapshot: () => okAsync(new Uint8Array()),
    reconnect: () => {},
    cleanup: () => listeners.clear(),
  };
  const [syncSource, setSyncSource] = createSignal<LiveSyncSource>();
  const [ready, setReady] = createSignal(false);
  let mounted: LexicalEditor | undefined;
  const editor = () => {
    if (!mounted) throw new Error('the editor has not mounted yet');
    return mounted;
  };

  background(
    (async () => {
      const snapshot = await server.fuzzConnect();
      await loroManager.ingest({ kind: 'dss', snapshot: fromBase64(snapshot) });
      setSyncSource(source);
    })()
  );

  const loroJson = () => JSON.stringify(loroManager.doc.toJSON());

  const api: LexFuzzApi = {
    deliver: (event) => {
      const bytes = fromBase64(event.bytes);
      const message: SyncSourceEvent = match(event.type)
        .with('update', () => ({ type: 'update' as const, update: bytes }))
        .with('awareness', () => ({
          type: 'awareness' as const,
          awareness: bytes,
        }))
        .exhaustive();
      for (const listener of listeners) listener(message);
    },
    seed: async (markdown) => {
      const snapshot = await markdownToLoroSnapshot(markdown);
      if (!snapshot) throw new Error('markdownToLoroSnapshot returned nothing');
      return toBase64(snapshot);
    },
    ready,
    editorMarkdown: () => editorStateAsMarkdown(editor(), 'internal'),
    loroMarkdown: () => stateToMarkdown(loroJson()),
    editorJson: () => JSON.stringify(loroSyncState(editor().getEditorState())),
    loroJson,
    blocks: () =>
      editor()
        .getEditorState()
        .read(() => $getRoot().getChildren().flatMap($blocks)),
    invariants: () => editor().getEditorState().read($invariants),
    errors: () => errors.slice(),
    placeAtEnd: (prefix) => {
      let found = false;
      editor().update(
        () => {
          const block = $getRoot()
            .getChildren()
            .find((child) => child.getTextContent().startsWith(prefix));
          if ($isElementNode(block)) {
            block.selectEnd();
            found = true;
          }
        },
        { discrete: true }
      );
      editor().focus();
      return found;
    },
    toMarkdown: stateToMarkdown,
    roundTrip: markdownRoundTrip,
    selection: () => editor().getEditorState().read($caret),
  };
  fuzzWindow.lexFuzz = api;

  return (
    <main class="p-4 text-ink bg-page">
      <Show when={syncSource()}>
        <FuzzEditor
          documentId={documentId}
          loroManager={loroManager}
          syncSource={syncSource}
          onEditor={(created) => {
            mounted = created;
          }}
          onReady={() => setReady(true)}
        />
      </Show>
    </main>
  );
}

/**
 * The editor `CollabMarkdownEditor` builds (same plugins, same
 * `registerMarkdownEditing`, same `CollabProvider`), minus the menus and drop
 * overlays, which need the whole app's providers.
 */
function FuzzEditor(props: {
  documentId: string;
  loroManager: CollabSurfaceLoroManager;
  syncSource: Accessor<LiveSyncSource | undefined>;
  onEditor: (editor: LexicalEditor) => void;
  onReady: () => void;
}) {
  const [editorReady, setEditorReady] = createSignal(false);
  const [editorError, setEditorError] =
    createSignal<MarkdownEditorErrors | null>(null);
  const isContentEditable = () => editorReady() && !editorError();
  const lexicalWrapper = createLexicalWrapper({
    type: 'markdown-sync',
    namespace: 'fuzz',
    isInteractable: isContentEditable,
    withIds: true,
  });
  if (!isWrapperWithIds(lexicalWrapper))
    throw new Error('the fuzz editor needs node ids');
  const { editor, plugins, cleanup } = lexicalWrapper;
  onCleanup(cleanup);
  props.onEditor(editor);
  onCleanup(
    editor.registerUpdateListener(({ tags, dirtyElements, dirtyLeaves }) => {
      updateLog.push(
        `${[...tags].join(',') || '-'} e${dirtyElements.size} l${dirtyLeaves.size}`
      );
      if (updateLog.length > 300) updateLog.shift();
    })
  );
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
  const [container, setContainer] = createSignal<HTMLDivElement>();
  return (
    <LexicalWrapperContext.Provider value={lexicalWrapper}>
      <div
        class="relative min-h-[300px] border border-edge-muted p-2"
        ref={setContainer}
      >
        <div
          ref={(el) => onElementConnect(el, () => editor.setRootElement(el))}
          contentEditable={isContentEditable()}
          role="textbox"
          aria-multiline="true"
          class="w-full outline-none"
        />
        <Show when={container()}>
          {(element) => (
            <CollabProvider
              editor={editor}
              pluginManager={plugins}
              editorContainerRef={element()}
              highlightLayerRef={element()}
              mappings={lexicalWrapper.mapping}
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
          )}
        </Show>
      </div>
    </LexicalWrapperContext.Provider>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('index.html has no #root');
const client = new QueryClient();
render(
  () => (
    <AnalyticsContextProvider>
      <PosthogProvider>
        <QueryClientProvider client={client}>
          <UserContextProvider>
            <DragDropProvider>
              <Peer />
            </DragDropProvider>
          </UserContextProvider>
        </QueryClientProvider>
      </PosthogProvider>
    </AnalyticsContextProvider>
  ),
  root
);
