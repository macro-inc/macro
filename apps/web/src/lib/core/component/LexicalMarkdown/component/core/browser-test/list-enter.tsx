import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { UserContextProvider } from '@core/context/user';
import { onElementConnect } from '@core/util/onElementConnect';
import {
  $isListItemNode,
  $isListNode,
  type ListItemNode,
  type ListNode,
} from '@lexical/list';
import { createPeerIdValidator } from '@macro-inc/lexical-core';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { DragDropProvider } from '@thisbeyond/solid-dnd';
import {
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  type ElementNode,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical';
import { createSignal, onCleanup, onMount, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { buildConfig } from '../../../builder/MarkdownConfigBuilder';
import { MarkdownShell } from '../../../builder/MarkdownShell';
import {
  createLexicalWrapper,
  LexicalWrapperContext,
} from '../../../context/LexicalWrapperContext';
import { registerMarkdownEditing } from '../../../editing/registerMarkdownEditing';
import { initializeLexical } from '../../../init';
import {
  editorStateAsMarkdown,
  setEditorStateFromMarkdown,
} from '../../../utils';
import { ComposerEditor } from '../../ComposerEditor';

/**
 * One editor flavor per page, picked by `?surface=`:
 * - `document`: the document editor's plugins (`registerMarkdownEditing` over
 *   a `markdown-sync` editor), as documents, task descriptions and other
 *   collaborative surfaces mount them.
 * - `markdown`: a `MarkdownShell` with no Enter handler of its own (routine
 *   prompts, the document composer).
 * - `chat`: a composer whose Enter sends, as channels, comments and AI inputs
 *   do; `sent()` lists what it sent.
 * The page offers `ListEnterApi` as `window.listEnter`.
 */
export type ListEnterApi = {
  /** Replaces the editor's content and forgets sent messages. */
  load: (markdown: string) => void;
  markdown: () => string;
  sent: () => string[];
  /**
   * One line per block: list items as `- text`, `1. text`, `[ ] text` or
   * `[x] text`, indented two spaces per level, paragraphs as `¶ text`.
   */
  outline: () => string[];
  /** Caret at the end, or start, of the block whose own text is `text`. */
  caretAt: (text: string, edge: 'start' | 'end') => boolean;
  /** The outline line of the block holding the caret. */
  caretLine: () => string | null;
};
export type ListEnterWindow = Window & { listEnter?: ListEnterApi };

initializeLexical();

const params = new URLSearchParams(window.location.search);
const surface = params.get('surface') ?? 'document';
const initial = params.get('initial') ?? '';

function ownText(block: ElementNode): string {
  return block
    .getChildren()
    .filter((child) => !$isListNode(child))
    .map((child) => child.getTextContent())
    .join('');
}

function $listItemLine(item: ListItemNode): string {
  let depth = 0;
  let node: LexicalNode | null = item.getParent();
  while (node) {
    if ($isListNode(node)) depth++;
    node = node.getParent();
  }
  const list = item.getParent() as ListNode;
  const marker = (() => {
    const type = list.getListType();
    if (type === 'number') return `${item.getValue()}.`;
    if (type === 'check') return item.getChecked() ? '[x]' : '[ ]';
    return '-';
  })();
  return `${'  '.repeat(depth - 1)}${marker} ${ownText(item)}`;
}

function $blockLine(block: ElementNode): string {
  if ($isListItemNode(block)) return $listItemLine(block);
  return `¶ ${ownText(block)}`;
}

/** Text-bearing blocks in document order (list items holding only a list are skipped). */
function $blocks(): ElementNode[] {
  const blocks: ElementNode[] = [];
  const visit = (node: LexicalNode) => {
    if ($isListNode(node)) {
      for (const child of node.getChildren()) visit(child);
      return;
    }
    if ($isListItemNode(node)) {
      const children = node.getChildren();
      const wrapper = children.length === 1 && $isListNode(children[0] ?? null);
      if (!wrapper) blocks.push(node);
      for (const child of children) if ($isListNode(child)) visit(child);
      return;
    }
    if ($isElementNode(node)) blocks.push(node);
  };
  for (const child of $getRoot().getChildren()) visit(child);
  return blocks;
}

function publish(
  editor: LexicalEditor,
  load: (markdown: string) => void,
  markdown: () => string,
  sent: () => string[]
) {
  const api: ListEnterApi = {
    load,
    markdown,
    sent,
    outline: () => editor.read(() => $blocks().map($blockLine)),
    caretAt: (text, edge) => {
      let found = false;
      editor.update(
        () => {
          const block = $blocks().find((node) => ownText(node) === text);
          if (!block) return;
          const inline = block.getChildren().filter((c) => !$isListNode(c));
          const target = edge === 'end' ? inline.at(-1) : inline[0];
          if (!target) block.select(0, 0);
          else if (edge === 'end') target.selectEnd();
          else target.selectStart();
          found = true;
        },
        { discrete: true }
      );
      editor.focus();
      return found;
    },
    caretLine: () =>
      editor.read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return null;
        const anchor = selection.anchor.getNode();
        const block = $blocks().find(
          (node) => node.is(anchor) || node.isParentOf(anchor)
        );
        return block ? $blockLine(block) : null;
      }),
  };
  (window as ListEnterWindow).listEnter = api;
}

function DocumentSurface() {
  const lexicalWrapper = createLexicalWrapper({
    type: 'markdown-sync',
    namespace: 'list-enter-document',
    isInteractable: () => true,
    withIds: true,
  });
  const { editor, plugins, cleanup } = lexicalWrapper;
  onCleanup(cleanup);
  plugins.richText().list().markdownShortcuts().delete().history(400);
  registerMarkdownEditing({
    lexicalWrapper,
    isContentEditable: () => true,
    peerIdValidator: createPeerIdValidator(() => undefined, false),
    source: { id: 'list-enter', trackMentions: false },
    onVersionError: () => {},
  });
  const [container, setContainer] = createSignal<HTMLDivElement>();
  onMount(() => {
    publish(
      editor,
      (markdown) => setEditorStateFromMarkdown(editor, markdown),
      () => editorStateAsMarkdown(editor),
      () => []
    );
  });
  return (
    <LexicalWrapperContext.Provider value={lexicalWrapper}>
      <div class="relative border border-edge-muted p-2" ref={setContainer}>
        <Show when={container()}>
          <div
            ref={(element) =>
              onElementConnect(element, () => {
                editor.setRootElement(element);
                editor.setEditable(true);
                setEditorStateFromMarkdown(editor, initial);
              })
            }
            contentEditable
            role="textbox"
            aria-label="Editor"
            aria-multiline="true"
            class="w-full min-h-48 outline-none"
          />
        </Show>
      </div>
    </LexicalWrapperContext.Provider>
  );
}

function MarkdownSurface() {
  const editor = buildConfig('markdown')
    .namespace('list-enter-markdown')
    .withHistory();
  onMount(() =>
    publish(
      editor.lexical,
      (markdown) => editor.controls.setMarkdown(markdown),
      () => editor.controls.getMarkdown(),
      () => []
    )
  );
  return (
    <MarkdownShell config={editor} initialValue={initial} ariaLabel="Editor" />
  );
}

function ChatSurface() {
  const [sent, setSent] = createSignal<string[]>([]);
  const editor = buildConfig('chat')
    .namespace('list-enter-chat')
    .withHistory()
    .onEnter((_event, markdown) => {
      setSent((previous) => [...previous, markdown]);
      return true;
    });
  onMount(() =>
    publish(
      editor.lexical,
      (markdown) => {
        setSent([]);
        editor.controls.setMarkdown(markdown);
      },
      () => editor.controls.getMarkdown(),
      sent
    )
  );
  return (
    <ComposerEditor config={editor} initialValue={initial} ariaLabel="Editor" />
  );
}

function Fixture() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  onCleanup(() => client.clear());
  return (
    <AnalyticsContextProvider>
      <PosthogProvider>
        <QueryClientProvider client={client}>
          <UserContextProvider>
            <DragDropProvider>
              <main class="h-dvh overflow-y-auto p-6 bg-page text-ink max-w-2xl space-y-6">
                <h1 class="text-xl font-medium">Enter in lists: {surface}</h1>
                <Show when={surface === 'document'}>
                  <DocumentSurface />
                </Show>
                <Show when={surface === 'markdown'}>
                  <MarkdownSurface />
                </Show>
                <Show when={surface === 'chat'}>
                  <ChatSurface />
                </Show>
              </main>
            </DragDropProvider>
          </UserContextProvider>
        </QueryClientProvider>
      </PosthogProvider>
    </AnalyticsContextProvider>
  );
}

render(() => <Fixture />, document.getElementById('root')!);
