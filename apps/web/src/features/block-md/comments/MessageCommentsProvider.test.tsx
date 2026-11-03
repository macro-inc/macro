import {
  DRAFT_THREAD_ID,
  type MessageCommentOperations,
} from '@core/comments/commentType';
import {
  LexicalWrapperContext,
  type LexicalWrapperWithMapping,
} from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import type { PluginManager } from '@core/component/LexicalMarkdown/plugins';
import { CREATE_DRAFT_COMMENT_COMMAND } from '@core/component/LexicalMarkdown/plugins/comments/commentPlugin';
import type { LoroManager } from '@macro-inc/collaboration/collab/manager';
import {
  $createCommentNode,
  CommentNode,
  peerIdPlugin,
} from '@macro-inc/lexical-core';
import type { MessageListItem } from '@service-storage/messages';
import { cleanup, render } from '@solidjs/testing-library';
import {
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $setSelection,
  createEditor,
  type LexicalEditor,
} from 'lexical';
import { batch, createSignal, onCleanup, onMount } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMarkdownDocumentState } from '../context/markdown-document-state';
import { MessageCommentsProvider } from './MessageCommentsProvider';
import { useCreateMessageComment } from './messageCommentOperations';

const mocks = vi.hoisted(() => ({
  state: undefined as
    | ReturnType<typeof createMarkdownDocumentState>
    | undefined,
  threads: (): MessageListItem[] => [],
  rootId: (): string | null => 'root',
  navigationCount: (): number => 0,
  post: vi.fn(),
}));

vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: vi.fn() }),
}));
vi.mock('./messageCommentsResource', () => ({
  useCreateMarkedMessageResource: () => mocks.post,
  useCreateMessageReplyResource: () => mocks.post,
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

function setup(lateEditor = false) {
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
  if (!lateEditor) state.editor.setMd('editor', editor);
  let post!: MessageCommentOperations['createComment'];
  function Posting() {
    post = useCreateMessageComment();
    return null;
  }
  render(() => (
    <LexicalWrapperContext.Provider value={wrapper}>
      <div
        ref={(el) => {
          onCleanup(
            peerIdPlugin({ peerId: () => '1', nodes: [CommentNode] })(editor)
          );
          onMount(() => editor.setRootElement(el));
          onCleanup(() => editor.setRootElement(null));
        }}
      />
      <Posting />
      <MessageCommentsProvider
        activeComment={activeComment}
        loroManager={{ peerIdStr: '1' } as unknown as LoroManager}
      />
    </LexicalWrapperContext.Provider>
  ));
  if (lateEditor) state.editor.setMd('editor', editor);
  return {
    editor,
    state,
    post: (input: Parameters<typeof post>[0]) => post(input),
    setThreads,
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
  it.each([false, true])(
    'opens another comment after posting, metadata first: %s',
    async (metadataFirst) => {
      const f = setup(true);
      f.finishLoading();
      f.editor.update(
        () => {
          $getRoot().append(
            $createParagraphNode().append(
              $createTextNode('A shared directory with useful notes.')
            )
          );
        },
        { discrete: true }
      );
      for (let attempt = 0; attempt < 3; attempt++) {
        f.editor.update(
          () => {
            const text = $getRoot()
              .getAllTextNodes()
              .find((node) => node.getTextContent().includes('shared'))!;
            const start = text.getTextContent().indexOf('shared');
            text.select(start, start + 6);
            expect(
              f.editor.dispatchCommand(CREATE_DRAFT_COMMENT_COMMAND, undefined)
            ).toBe(true);
          },
          { discrete: true }
        );
        expect(f.state.comments.activeCommentThread).toBe(DRAFT_THREAD_ID);
        const anchorId = f.state.comments.threads[DRAFT_THREAD_ID]!.anchorId;
        const posted = {
          ...thread,
          id: `root-${attempt}`,
          state: {
            ...thread.state,
            root_id: `root-${attempt}`,
            anchor: { type: 'markdown' as const, mark_id: anchorId },
          },
        };
        mocks.post.mockImplementationOnce(async () => {
          if (metadataFirst) f.setThreads((previous) => [...previous, posted]);
          return posted;
        });
        await f.post({ threadId: DRAFT_THREAD_ID, content: 'A comment' });
        if (!metadataFirst) f.setThreads((previous) => [...previous, posted]);
        await Promise.resolve();
        expect(f.editor.getRootElement()?.textContent).toBe(
          'A shared directory with useful notes.'
        );
        expect(
          f.editor.getRootElement()?.querySelectorAll('mark.draft')
        ).toHaveLength(0);
        f.state.setCommentState('activeCommentThread', null);
      }
    }
  );
  it('opens a new draft inside an existing comment and preserves that comment on cancellation', async () => {
    const f = setup();
    f.loadMarks();
    f.loadComments();
    f.finishLoading();
    f.editor.update(
      () => {
        const text = $getRoot().getAllTextNodes()[0];
        text.select(2, 7);
        expect(
          f.editor.dispatchCommand(CREATE_DRAFT_COMMENT_COMMAND, undefined)
        ).toBe(true);
      },
      { discrete: true }
    );
    expect(f.state.comments.activeCommentThread).toBe(DRAFT_THREAD_ID);
    expect(f.state.comments.threads[DRAFT_THREAD_ID]?.isNew).toBe(true);
    f.state.setCommentState('activeCommentThread', null);
    await Promise.resolve();
    expect(f.state.comments.threads.root?.anchorId).toBe('mark');
    expect(f.editor.getRootElement()?.textContent).toBe('Commented text');
  });
  it('retains every anchor fragment for a draft spanning paragraphs', () => {
    const f = setup();
    f.editor.update(
      () => {
        const first = $createTextNode('First paragraph');
        const last = $createTextNode('Last paragraph');
        $getRoot().append(
          $createParagraphNode().append(first),
          $createParagraphNode().append(last)
        );
        const selection = $createRangeSelection();
        selection.anchor.set(first.getKey(), 0, 'text');
        selection.focus.set(last.getKey(), 4, 'text');
        $setSelection(selection);
        f.editor.dispatchCommand(CREATE_DRAFT_COMMENT_COMMAND, undefined);
      },
      { discrete: true }
    );
    const draft = f.state.comments.threads[DRAFT_THREAD_ID];
    expect(draft?.isNew).toBe(true);
    expect(
      Object.values(f.state.comments.marks[draft!.anchorId]!.markNodes).filter(
        Boolean
      )
    ).toHaveLength(2);
  });

  it.each([false, true])(
    'opens and cancels a draft (editor published after mounting: %s)',
    async (lateEditor) => {
      const f = setup(lateEditor);
      f.editor.update(
        () => {
          const text = $createTextNode('Text to comment on');
          $getRoot().append($createParagraphNode().append(text));
          text.select(0, 4);
        },
        { discrete: true }
      );
      f.editor.update(
        () => {
          expect(
            f.editor.dispatchCommand(CREATE_DRAFT_COMMENT_COMMAND, undefined)
          ).toBe(true);
        },
        { discrete: true }
      );
      expect(f.state.comments.activeCommentThread).toBe(DRAFT_THREAD_ID);
      expect(f.state.comments.threads[DRAFT_THREAD_ID]?.isNew).toBe(true);
      expect(f.editor.getRootElement()?.querySelectorAll('mark')).toHaveLength(
        1
      );
      f.state.setCommentState('activeCommentThread', null);
      await Promise.resolve();
      expect(f.editor.getRootElement()?.querySelectorAll('mark')).toHaveLength(
        0
      );
    }
  );
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
