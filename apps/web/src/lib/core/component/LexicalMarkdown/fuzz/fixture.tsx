/**
 * One fuzz peer: the real collaborative markdown editor (`CollabMarkdownEditor`,
 * so the real CollabProvider, sync engine, WAL, reconcile, and cursors) over a
 * `LiveSyncSource` whose other end is the Playwright process. Every byte this
 * peer sends or receives goes through `window.fuzz*` bindings the test exposes,
 * so the test decides when, and in what order, each peer sees each update.
 *
 * `window.lexFuzz` reads this peer's state back for the oracles.
 */

import '../../../../../index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import type { CollabSurfaceLoroManager } from '@core/collab-surface/createCollabSurface';
import { UserContextProvider } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { $isCodeNode } from '@lexical/code';
import { createHeadlessEditor } from '@lexical/headless';
import { $isListItemNode, $isListNode } from '@lexical/list';
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
  $isCustomCodeNode,
  createPeerIdValidator,
  INTERNAL_TRANSFORMERS,
  NodeReplacements,
  SupportedNodeTypes,
} from '@macro-inc/lexical-core';
import { MARKDOWN_LORO_SCHEMA } from '@macro-inc/lexical-core/markdown-loro-schema';
import { markdownToLoroSnapshot } from '@macro-inc/lexical-core/markdown-loro-snapshot';
import { onElementConnect } from '@solid-primitives/lifecycle';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { DragDropProvider } from '@thisbeyond/solid-dnd';
import {
  $getRoot,
  $getSelection,
  $isElementNode,
  $isParagraphNode,
  $isRangeSelection,
  type LexicalEditor,
  type LexicalNode,
  type SerializedEditorState,
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
import { CollabProvider } from '../collaboration/CollabProvider';
import type { MarkdownEditorErrors } from '../constants';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '../context/LexicalWrapperContext';
import { registerMarkdownEditing } from '../editing/registerMarkdownEditing';
import {
  editorFocusSignal,
  editorStateAsMarkdown,
  loroSyncState,
} from '../utils';

type WireEvent = { type: 'update' | 'awareness'; bytes: string };

/** A top-level block as the oracle sees it. */
export type FuzzBlock = { type: string; text: string; indent?: number };

declare global {
  interface Window {
    // Bindings the Playwright test exposes.
    fuzzConnect: () => Promise<string>;
    fuzzPush: (bytes: string) => Promise<boolean>;
    fuzzAwareness: (bytes: string) => Promise<void>;
    fuzzSince: (version: string) => Promise<string>;
    // Called by the test to hand this peer a message.
    fuzzDeliver: (event: WireEvent) => void;
    lexFuzz?: {
      /** A server snapshot holding `markdown`, as a new document's would. */
      seed: (markdown: string) => Promise<string>;
      ready: () => boolean;
      peerId: () => string;
      editorMarkdown: () => string;
      loroMarkdown: () => string;
      editorJson: () => string;
      loroJson: () => string;
      blocks: () => FuzzBlock[];
      invariants: () => string[];
      errors: () => string[];
      /** Caret at the end of the top-level block whose text starts with `prefix`. */
      placeAtEnd: (prefix: string) => boolean;
      /** Internal markdown of any serialized state (the server's, say). */
      toMarkdown: (json: string) => string;
      /** Internal markdown → state → internal markdown. */
      roundTrip: (markdown: string) => string;
      /** Lexical's caret: the text of its block, and how much of it is before the caret. */
      selection: () => FuzzCaret | null;
    };
  }
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
window.addEventListener('error', (e) =>
  errors.push(`uncaught: ${e.message} ${e.error?.stack ?? ''}`)
);
window.addEventListener('unhandledrejection', (e) =>
  errors.push(`unhandled rejection: ${String(e.reason?.stack ?? e.reason)}`)
);

const headless = () =>
  createHeadlessEditor({
    nodes: [...SupportedNodeTypes, ...NodeReplacements],
    onError: (e) => {
      throw e;
    },
  });

/** As lexical-service's `toMarkdownText(state, 'internal')`. */
function stateToMarkdown(state: SerializedEditorState): string {
  const editor = headless();
  editor.setEditorState(editor.parseEditorState(state));
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

function $blockOf(node: LexicalNode): FuzzBlock[] {
  if ($isListNode(node)) {
    const kind =
      node.getListType() === 'number'
        ? 'ol'
        : node.getListType() === 'check'
          ? 'check'
          : 'ul';
    const items: FuzzBlock[] = [];
    for (const item of node.getChildren()) {
      if (!$isListItemNode(item)) {
        items.push({
          type: `${kind}>${item.getType()}`,
          text: item.getTextContent(),
        });
        continue;
      }
      const nested = item.getChildren().find($isListNode);
      if (nested)
        items.push(
          ...$blockOf(nested).map((b) => ({
            ...b,
            indent: (b.indent ?? 0) + 1,
          }))
        );
      else items.push({ type: kind, text: item.getTextContent() });
    }
    return items;
  }
  if ($isHeadingNode(node))
    return [{ type: node.getTag(), text: node.getTextContent() }];
  if ($isQuoteNode(node))
    return [{ type: 'quote', text: node.getTextContent() }];
  if ($isCodeNode(node) || $isCustomCodeNode(node))
    return [{ type: 'code', text: node.getTextContent() }];
  if ($isParagraphNode(node))
    return [{ type: 'p', text: node.getTextContent() }];
  return [{ type: node.getType(), text: node.getTextContent() }];
}

export type FuzzCaret = {
  collapsed: boolean;
  blockType: string;
  text: string;
  before: string;
};

function $caret(): FuzzCaret | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return null;
  const anchor = selection.anchor.getNode();
  const block = $findMatchingParent(
    anchor,
    (n) =>
      $isListItemNode(n) ||
      $isHeadingNode(n) ||
      $isQuoteNode(n) ||
      $isCodeNode(n) ||
      $isCustomCodeNode(n) ||
      $isParagraphNode(n)
  );
  if (!$isElementNode(block)) return null;
  let before = '';
  if ($isElementNode(anchor)) {
    for (const child of anchor.getChildren().slice(0, selection.anchor.offset))
      before += child.getTextContent();
    let node: LexicalNode = anchor;
    while (node !== block) {
      before =
        node
          .getPreviousSiblings()
          .map((s) => s.getTextContent())
          .join('') + before;
      node = node.getParentOrThrow();
    }
  } else {
    before = anchor.getTextContent().slice(0, selection.anchor.offset);
    let node: LexicalNode = anchor;
    while (node !== block) {
      before =
        node
          .getPreviousSiblings()
          .map((s) => s.getTextContent())
          .join('') + before;
      node = node.getParentOrThrow();
    }
  }
  return {
    collapsed: selection.isCollapsed(),
    blockType: $isListItemNode(block)
      ? ($blockOf(block.getParentOrThrow())[0]?.type ?? 'listitem')
      : ($blockOf(block)[0]?.type ?? block.getType()),
    text: block.getTextContent(),
    before,
  };
}

function $invariants(): string[] {
  const problems: string[] = [];
  const root = $getRoot();
  if (root.getChildrenSize() === 0) problems.push('root has no children');
  for (const child of root.getChildren()) {
    if (
      !$isElementNode(child) &&
      child.getType() !== 'horizontalrule' &&
      !child.isInline?.()
    )
      continue;
    if ($isElementNode(child) && child.isInline())
      problems.push(`inline ${child.getType()} directly under root`);
    if (!$isElementNode(child) && child.isInline?.())
      problems.push(`inline ${child.getType()} directly under root`);
  }
  const walk = (node: LexicalNode) => {
    if ($isListNode(node))
      for (const c of node.getChildren())
        if (!$isListItemNode(c)) problems.push(`list holds ${c.getType()}`);
    if ($isListItemNode(node) && !$isListNode(node.getParent()))
      problems.push(`listitem under ${node.getParent()?.getType()}`);
    if ($isElementNode(node)) for (const c of node.getChildren()) walk(c);
  };
  walk(root);
  return problems;
}

function idProblems(state: SerializedEditorState): string[] {
  const seen = new Map<string, string>();
  const problems: string[] = [];
  const walk = (node: Record<string, unknown>, path: string) => {
    const id = (node.$ as { id?: string } | undefined)?.id;
    if (node.type !== 'root') {
      if (!id) problems.push(`no id at ${path} (${String(node.type)})`);
      else if (seen.has(id))
        problems.push(`duplicate id ${id} at ${path} and ${seen.get(id)}`);
      else seen.set(id, path);
    }
    const children = node.children as Record<string, unknown>[] | undefined;
    children?.forEach((c, i) => walk(c, `${path}/${i}`));
  };
  walk(state.root as unknown as Record<string, unknown>, 'root');
  return problems;
}

function Peer() {
  const documentId = new URLSearchParams(location.search).get('doc') ?? 'fuzz';
  const loroManager = createLoroManager(MARKDOWN_LORO_SCHEMA, { documentId });
  const listeners = new Set<(event: SyncSourceEvent) => void>();
  window.fuzzDeliver = (event) => {
    const bytes = fromBase64(event.bytes);
    const message: SyncSourceEvent =
      event.type === 'update'
        ? { type: 'update', update: bytes }
        : { type: 'awareness', awareness: bytes };
    for (const listener of listeners) listener(message);
  };
  const source: LiveSyncSource = {
    documentId,
    status: () => SyncSourceStatus.Connected,
    listen: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    pushUpdate: async (updates) => {
      const acks = await Promise.all(
        updates.map((u) => window.fuzzPush(toBase64(u)))
      );
      return acks.every(Boolean);
    },
    pushAwareness: (value) => {
      fireAndForget(window.fuzzAwareness(toBase64(value)), 'lexical-fuzz');
    },
    registerPeerId: () => {},
    requestUpdatesSince: (version: VersionVector) =>
      ResultAsync.fromPromise(
        window.fuzzSince(toBase64(version.encode())),
        (error): SyncError => SyncError.unknown(new Error(String(error)))
      ).map(fromBase64),
    requestSnapshot: () => okAsync(new Uint8Array()),
    reconnect: () => {},
    cleanup: () => listeners.clear(),
  };
  const [syncSource, setSyncSource] = createSignal<LiveSyncSource>();
  const [ready, setReady] = createSignal(false);
  let editor: LexicalEditor | undefined;

  const connect = async () => {
    const snapshot = await window.fuzzConnect();
    await loroManager.ingest({ kind: 'dss', snapshot: fromBase64(snapshot) });
    setSyncSource(source);
  };
  fireAndForget(connect(), 'lexical-fuzz');

  const loroState = () =>
    loroManager.doc.toJSON() as unknown as SerializedEditorState;

  window.lexFuzz = {
    seed: async (markdown) => {
      const snapshot = await markdownToLoroSnapshot(markdown);
      if (!snapshot) throw new Error('no snapshot');
      return toBase64(snapshot);
    },
    ready,
    peerId: () => loroManager.peerIdStr,
    editorMarkdown: () =>
      editor ? editorStateAsMarkdown(editor, 'internal') : '',
    loroMarkdown: () => stateToMarkdown(loroState()),
    editorJson: () =>
      editor ? JSON.stringify(loroSyncState(editor.getEditorState())) : '',
    loroJson: () => JSON.stringify(loroState()),
    blocks: () =>
      editor
        ?.getEditorState()
        .read(() => $getRoot().getChildren().flatMap($blockOf)) ?? [],
    invariants: () => {
      if (!editor) return ['no editor'];
      const lexical = editor.getEditorState().read($invariants);
      const ids = idProblems(
        loroSyncState(editor.getEditorState()) as SerializedEditorState
      );
      return [...lexical, ...ids];
    },
    errors: () => errors.slice(),
    placeAtEnd: (prefix) => {
      if (!editor) return false;
      let found = false;
      editor.update(
        () => {
          const block = $getRoot()
            .getChildren()
            .find((c) => c.getTextContent().startsWith(prefix));
          if ($isElementNode(block)) {
            block.selectEnd();
            found = true;
          }
        },
        { discrete: true }
      );
      editor.focus();
      return found;
    },
    toMarkdown: (json) => stateToMarkdown(JSON.parse(json)),
    roundTrip: markdownRoundTrip,
    selection: () => editor?.getEditorState().read($caret) ?? null,
  };

  return (
    <main class="p-4 text-ink bg-page">
      <Show when={syncSource()}>
        <FuzzEditor
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
  let container!: HTMLDivElement;
  return (
    <LexicalWrapperContext.Provider value={lexicalWrapper}>
      <div
        class="relative min-h-[300px] border border-edge-muted p-2"
        ref={container}
      >
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
              <Peer />
            </DragDropProvider>
          </UserContextProvider>
        </QueryClientProvider>
      </PosthogProvider>
    </AnalyticsContextProvider>
  ),
  document.getElementById('root')!
);
