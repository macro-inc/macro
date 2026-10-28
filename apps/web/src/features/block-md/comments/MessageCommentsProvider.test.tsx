import {
  LexicalWrapperContext,
  type LexicalWrapperWithMapping,
} from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import type { PluginManager } from '@core/component/LexicalMarkdown/plugins';
import type { LoroManager } from '@macro-inc/collaboration/collab/manager';
import { $createCommentNode, CommentNode } from '@macro-inc/lexical-core';
import type { MessageListItem } from '@service-storage/messages';
import { cleanup, render } from '@solidjs/testing-library';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  type LexicalEditor,
} from 'lexical';
import { batch, createSignal, onCleanup, onMount } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMarkdownDocumentState } from '../context/markdown-document-state';
import { MessageCommentsProvider } from './MessageCommentsProvider';

const mocks = vi.hoisted(() => ({
  state: undefined as
    | ReturnType<typeof createMarkdownDocumentState>
    | undefined,
  threads: (): MessageListItem[] => [],
  rootId: (): string | null => 'root',
  navigationCount: (): number => 0,
}));

vi.mock('../context/markdown-document-context', () => ({
  useMarkdownDocument: () => ({
    documentId: () => 'document',
    state: mocks.state,
    permissions: { canEdit: () => false, canComment: () => true },
  }),
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'macro|reader@example.com',
}));
vi.mock('@core/component/LexicalMarkdown/plugins', () => ({
  autoRegister: (...disposers: (() => void)[]) => disposers.forEach(onCleanup),
}));
vi.mock('@core/component/ParamsProvider', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useParamNavigationCount: () => () => mocks.navigationCount(),
}));
vi.mock('@queries/messages/document-messages', () => ({
  useMessageRootsQuery: () => ({
    isSuccess: true,
    get data() {
      return mocks.threads();
    },
  }),
  useMessageLink: (_parent: unknown, target: () => string | undefined) => ({
    messageId: target,
    rootId: () => mocks.rootId(),
  }),
}));
vi.mock('@queries/messages/mutations', () => ({
  usePatchThreadMutation: () => ({ mutate: vi.fn() }),
}));
vi.mock('@queries/messages/sync', () => ({
  onThreadStateUpdated: () => () => {},
}));
vi.mock('./commentOperations', () => ({
  useDeleteNewComments: () => () => {},
}));

const thread: MessageListItem = {
  id: 'root',
  parent: { type: 'document', id: 'document' },
  sender_id: 'macro|reader@example.com',
  content: 'Root comment',
  mentions: [],
  attachments: [],
  reactions: [],
  created_at: '2026-09-29T00:00:00Z',
  updated_at: '2026-09-29T00:00:00Z',
  state: {
    root_id: 'root',
    user_id: 'macro|reader@example.com',
    resolved: false,
    created_at: '2026-09-29T00:00:00Z',
    updated_at: '2026-09-29T00:00:00Z',
    anchor: { type: 'markdown', mark_id: 'mark' },
  },
  thread: { reply_count: 1, preview: [], latest_reply_at: null },
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup() {
  const state = createMarkdownDocumentState();
  mocks.state = state;
  const [threads, setThreads] = createSignal<MessageListItem[]>([]);
  const [rootId, setRootId] = createSignal<string | null>(null);
  const [navigationCount, setNavigationCount] = createSignal(0);
  const [activeComment, setActiveComment] = createSignal<string | undefined>(
    'reply',
    { equals: false }
  );
  mocks.threads = threads;
  mocks.rootId = rootId;
  mocks.navigationCount = navigationCount;
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  const editor = createEditor({
    namespace: 'comment-link',
    nodes: [CommentNode],
    onError: (error) => {
      throw error;
    },
  });
  const wrapper: LexicalWrapperWithMapping = {
    type: 'markdown',
    owner: null,
    editor,
    cleanup: () => {},
    isInteractable: () => true,
    mapping: { idToNodeKeyMap: new Map(), nodeKeyToIdMap: new Map() },
    plugins: {
      use: (plugin: (editor: LexicalEditor) => () => void) =>
        onCleanup(plugin(editor)),
    } as unknown as PluginManager,
  };
  render(() => (
    <LexicalWrapperContext.Provider value={wrapper}>
      <div
        ref={(el) => {
          onMount(() => editor.setRootElement(el));
          onCleanup(() => editor.setRootElement(null));
        }}
      />
      <MessageCommentsProvider
        activeComment={activeComment}
        loroManager={{ peerIdStr: '1' } as unknown as LoroManager}
      />
    </LexicalWrapperContext.Provider>
  ));
  return {
    state,
    scroll,
    loadComments: () =>
      batch(() => {
        setRootId('root');
        setThreads([thread]);
      }),
    loadMarks: () =>
      editor.update(
        () => {
          const mark = $createCommentNode({ ids: ['mark'], isDraft: false });
          mark.append($createTextNode('Commented text'));
          $getRoot().append($createParagraphNode().append(mark));
        },
        { discrete: true }
      ),
    finishLoading: () => state.editor.setMd('locationReady', true),
    detachEditor: () => {
      const root = editor.getRootElement()!;
      const parent = root.parentElement!;
      root.remove();
      return () => parent.append(root);
    },
    navigateAgain: () =>
      batch(() => {
        setNavigationCount((count) => count + 1);
        setActiveComment('reply');
      }),
  };
}

describe('inline comment link navigation', () => {
  it('waits for editor initialization even when comments and marks arrive first', () => {
    const f = setup();
    f.loadComments();
    f.loadMarks();
    expect(f.state.comments.commentMarksInitialized).toBe(true);
    expect(f.scroll).not.toHaveBeenCalled();
    expect(f.state.comments.activeCommentThread).toBeNull();

    f.finishLoading();
    expect(f.scroll).toHaveBeenCalledOnce();
    expect(f.state.comments.activeCommentThread).toBe('root');
    expect(f.state.comments.highlightedCommentId).toBe('reply');
  });

  it('waits for comment data when the editor loads first', () => {
    const f = setup();
    f.loadMarks();
    f.finishLoading();
    expect(f.scroll).not.toHaveBeenCalled();
    f.loadComments();
    expect(f.scroll).toHaveBeenCalledOnce();
    expect(f.state.comments.highlightedCommentId).toBe('reply');
  });

  it('does not steal focus after handling a link, but allows another click', () => {
    const f = setup();
    f.loadComments();
    f.loadMarks();
    f.finishLoading();
    f.state.setCommentState('activeCommentThread', null);
    f.state.setCommentState('highlightedCommentId', null);
    f.loadComments();
    expect(f.scroll).toHaveBeenCalledOnce();
    expect(f.state.comments.highlightedCommentId).toBeNull();

    f.navigateAgain();
    expect(f.scroll).toHaveBeenCalledTimes(2);
    expect(f.state.comments.highlightedCommentId).toBe('reply');
  });

  it('keeps the navigation pending while the editor is detached', () => {
    const callbacks = new Set<() => void>();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private callback: () => void) {}
        observe() {
          callbacks.add(this.callback);
        }
        disconnect() {
          callbacks.delete(this.callback);
        }
      }
    );
    const f = setup();
    const reattach = f.detachEditor();
    f.loadComments();
    f.loadMarks();
    f.finishLoading();
    expect(f.scroll).not.toHaveBeenCalled();

    reattach();
    for (const callback of callbacks) callback();
    expect(f.scroll).toHaveBeenCalledOnce();
    expect(f.state.comments.activeCommentThread).toBe('root');
    expect(f.state.comments.highlightedCommentId).toBe('reply');
    expect(callbacks.size).toBe(0);
  });
});
