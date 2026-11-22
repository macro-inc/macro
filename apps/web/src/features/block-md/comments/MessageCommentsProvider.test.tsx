import 'fake-indexeddb/auto';
import { appendFileSync } from 'node:fs';
import {
  DRAFT_THREAD_ID,
  type MessageCommentOperations,
} from '@core/comments/commentType';
import { FLUSH_COLLABORATION_COMMAND } from '@core/component/LexicalMarkdown/collaboration/flush';
import {
  LexicalWrapperContext,
  type LexicalWrapperWithMapping,
} from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import type { PluginManager } from '@core/component/LexicalMarkdown/plugins';
import { CREATE_DRAFT_COMMENT_COMMAND } from '@core/component/LexicalMarkdown/plugins/comments/commentPlugin';
import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
  TableCellNode,
  TableNode,
  TableRowNode,
} from '@lexical/table';
import { LoroManager } from '@macro-inc/collaboration/collab/manager';
import { createNoopLiveSyncSource } from '@macro-inc/collaboration/collab/source';
import {
  $createCommentNode,
  $getCommentMarkText,
  $updateAllNodeIds,
  CommentNode,
  peerIdPlugin,
} from '@macro-inc/lexical-core';
import { MARKDOWN_LORO_SCHEMA } from '@macro-inc/lexical-core/markdown-loro-schema';
import { markdownToLoroSnapshot } from '@macro-inc/lexical-core/markdown-loro-snapshot';
import type { MessageListItem } from '@service-storage/messages';
import { cleanup, render } from '@solidjs/testing-library';
import {
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $setSelection,
  COMMAND_PRIORITY_NORMAL,
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
  publish: vi.fn().mockResolvedValue(true),
  removePublished: vi.fn().mockResolvedValue(true),
}));

vi.mock('./publishCommentMark', () => ({
  publishCommentMark: (...args: unknown[]) => mocks.publish(...args),
  removePublishedCommentMark: (...args: unknown[]) =>
    mocks.removePublished(...args),
}));
vi.mock('@core/component/LexicalMarkdown/component/core/Highlights', () => ({
  LocationHighlight: () => null,
}));

vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: vi.fn() }),
}));
vi.mock('@queries/messages/posted-comment', () => ({
  hasPostedComment: async () => false,
}));
vi.mock('./messageCommentsResource', () => ({
  useCreateMarkedMessageResource: () => mocks.post,
  useCreateMessageReplyResource: () => mocks.post,
}));
vi.mock('../context/markdown-document-context', () => ({
  useMarkdownDocument: () => ({
    documentId: () => 'document',
    documentSource: () => ({
      type: 'sync',
      source: createNoopLiveSyncSource('document'),
    }),
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
  mocks.publish.mockReset().mockResolvedValue(true);
  mocks.removePublished.mockReset().mockResolvedValue(true);
  mocks.post.mockReset();
});

function setup(lateEditor = false) {
  const manager: LoroManager = new LoroManager(MARKDOWN_LORO_SCHEMA, {
    documentId: 'document',
  });
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
    nodes: [CommentNode, TableNode, TableRowNode, TableCellNode],
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
          onCleanup(
            editor.registerCommand(
              FLUSH_COLLABORATION_COMMAND,
              (done) => {
                done(true);
                return true;
              },
              COMMAND_PRIORITY_NORMAL
            )
          );
          onMount(() => editor.setRootElement(el));
          onCleanup(() => editor.setRootElement(null));
        }}
      />
      <Posting />
      <MessageCommentsProvider
        activeComment={activeComment}
        loroManager={manager}
      />
    </LexicalWrapperContext.Provider>
  ));
  if (lateEditor) state.editor.setMd('editor', editor);
  return {
    editor,
    state,
    post: (input: Parameters<typeof post>[0]) => post(input),
    synchronize: async () => {
      editor.update(() => $updateAllNodeIds(wrapper.mapping), {
        discrete: true,
      });
      if (!manager.initialized) {
        const snapshot = await markdownToLoroSnapshot('Initial text');
        if (!snapshot) throw new Error('Missing snapshot');
        await manager.initializeFromSnapshot(snapshot);
      }
      await manager.syncToLoro({ ...editor.getEditorState().toJSON() });
    },
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
  it('reads a retained draft range inside a real table shadow after the caret moves', async () => {
    const f = setup();
    f.editor.update(
      () => {
        const table = $createTableNode();
        const row = $createTableRowNode();
        const cell = (value: string) =>
          $createTableCellNode().append(
            $createParagraphNode().append($createTextNode(value))
          );
        table.append(row.append(cell('Cell 1:1'), cell('Cell 1:2')));
        $getRoot().append(table);
        $getRoot().getAllTextNodes()[0].select(1, 5);
      },
      { discrete: true }
    );
    await f.synchronize();
    f.editor.update(
      () => {
        f.editor.dispatchCommand(CREATE_DRAFT_COMMENT_COMMAND, undefined);
      },
      { discrete: true }
    );
    const id = f.state.comments.threads[DRAFT_THREAD_ID]!.anchorId;
    const publication = f.state.comments.marks[id]?.publication;
    if (!publication) throw new Error('Missing table draft');
    expect(publication.text()).toBe('ell ');
    f.editor.update(
      () => {
        $getRoot().getAllTextNodes()[1].select(0, 8);
      },
      { discrete: true }
    );
    expect(publication.text()).toBe('ell ');
  });

  it('keeps message quote and publication expected text as independent reads', async () => {
    const f = setup();
    f.editor.update(
      () => {
        const text = $createTextNode('before');
        $getRoot().append($createParagraphNode().append(text));
        text.select(0, 6);
      },
      { discrete: true }
    );
    await f.synchronize();
    f.editor.update(
      () => {
        f.editor.dispatchCommand(CREATE_DRAFT_COMMENT_COMMAND, undefined);
      },
      { discrete: true }
    );
    const id = f.state.comments.threads[DRAFT_THREAD_ID]!.anchorId;
    const publication = f.state.comments.marks[id]?.publication;
    if (!publication) throw new Error('Missing publication');
    // Controlled first read pins chronology, not a real simultaneous edit.
    const quote = vi
      .spyOn(publication, 'text')
      .mockReturnValueOnce('message quote');
    try {
      mocks.post.mockResolvedValueOnce(null);
      await f.post({ threadId: DRAFT_THREAD_ID, content: 'Comment' });
      expect(quote).toHaveBeenCalledTimes(1);
      expect(mocks.publish).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'before' })
      );
      expect(mocks.post).toHaveBeenCalledWith(
        'Comment',
        id,
        'message quote',
        undefined,
        undefined
      );
    } finally {
      quote.mockRestore();
    }
  });

  it.each([
    ['range', false],
    ['range', true],
    ['edit', false],
    ['edit', true],
    ['whitespace-mark', false],
    ['whitespace-mark', true],
  ] as const)(
    'pins raw Source durable quote separators: %s backward=%s',
    async (profile, backward) => {
      const f = setup();
      const first = profile === 'whitespace-mark' ? '   ' : 'before';
      let endpoints: unknown;
      f.editor.update(
        () => {
          const a = $createTextNode(first),
            b = $createTextNode('second');
          $getRoot().append(
            $createParagraphNode().append(a),
            $createParagraphNode().append(b)
          );
          const range = $createRangeSelection();
          const start = { key: a.getKey(), offset: 0, type: 'text' as const };
          const end = { key: b.getKey(), offset: 6, type: 'text' as const };
          const anchor = backward ? end : start,
            focus = backward ? start : end;
          range.anchor.set(anchor.key, anchor.offset, anchor.type);
          range.focus.set(focus.key, focus.offset, focus.type);
          $setSelection(range);
          endpoints = { anchor, focus };
        },
        { discrete: true }
      );
      await f.synchronize();
      f.editor.update(
        () => {
          f.editor.dispatchCommand(CREATE_DRAFT_COMMENT_COMMAND, undefined);
        },
        { discrete: true }
      );
      const id = f.state.comments.threads[DRAFT_THREAD_ID]!.anchorId;
      const publication = f.state.comments.marks[id]?.publication;
      if (!publication) throw new Error('Missing multi-block draft');
      f.editor.update(
        () => {
          $getRoot().getAllTextNodes()[0].select(0, 0);
        },
        { discrete: true }
      );
      if (profile === 'edit') {
        f.editor.update(
          () => {
            $getRoot().getAllTextNodes()[0].spliceText(3, 0, 'Z');
          },
          { discrete: true }
        );
        await f.synchronize();
      }
      if (profile === 'whitespace-mark') {
        // Actual matching CommentNode with whitespace-only text: trimmed mark
        // helper is empty, so the retained durable range remains authoritative.
        f.editor.update(
          () => {
            const text = $getRoot().getAllTextNodes()[0];
            const mark = $createCommentNode({ ids: [id], isDraft: false });
            text.replace(mark);
            mark.append(text);
          },
          { discrete: true }
        );
        await f.synchronize();
      }
      const marked = f.editor.read(() => $getCommentMarkText(id));
      const text = publication.text();
      const record = {
        profile,
        backward,
        endpoints,
        marked,
        text,
        firstText: first,
        secondText: 'second',
        model: f.editor.getEditorState().toJSON(),
      };
      const output = process.env.SOURCE_QUOTE_PROFILE_OUT;
      if (output) appendFileSync(output, JSON.stringify(record) + '\n');
      expect(marked).toBe('');
      expect(text).toBe(
        profile === 'whitespace-mark'
          ? '   \nsecond'
          : profile === 'edit'
            ? 'befZore\nsecond'
            : 'before\nsecond'
      );
    }
  );

  it('keeps the draft and posts no message when its anchor is not acknowledged', async () => {
    const f = setup();
    f.editor.update(
      () => {
        const text = $createTextNode('Selected passage');
        $getRoot().append($createParagraphNode().append(text));
        text.select(0, 8);
      },
      { discrete: true }
    );
    await f.synchronize();
    f.editor.update(
      () => {
        f.editor.dispatchCommand(CREATE_DRAFT_COMMENT_COMMAND, undefined);
      },
      { discrete: true }
    );
    const anchorId = f.state.comments.threads[DRAFT_THREAD_ID]!.anchorId;
    mocks.publish.mockResolvedValueOnce(false);
    expect(
      await f.post({ threadId: DRAFT_THREAD_ID, content: 'Keep this comment' })
    ).toBeNull();
    expect(mocks.post).not.toHaveBeenCalled();
    expect(f.state.comments.threads[DRAFT_THREAD_ID]?.anchorId).toBe(anchorId);
  });

  it('does not post or clear a newer draft when an abandoned publication finishes', async () => {
    const f = setup();
    f.editor.update(
      () => {
        const text = $createTextNode('First and second');
        $getRoot().append($createParagraphNode().append(text));
        text.select(0, 5);
      },
      { discrete: true }
    );
    await f.synchronize();
    f.editor.update(
      () => {
        f.editor.dispatchCommand(CREATE_DRAFT_COMMENT_COMMAND, undefined);
      },
      { discrete: true }
    );
    const firstId = f.state.comments.threads[DRAFT_THREAD_ID]!.anchorId;
    let finish!: (accepted: boolean) => void;
    let started!: () => void;
    const publicationStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const publication = new Promise<boolean>((resolve) => {
      finish = resolve;
    });
    mocks.publish.mockImplementationOnce(() => {
      started();
      return publication;
    });
    const firstPost = f.post({
      threadId: DRAFT_THREAD_ID,
      content: 'First comment',
    });
    await publicationStarted;
    f.state.setCommentState('activeCommentThread', null);
    f.editor.update(
      () => {
        $getRoot().getAllTextNodes()[0].select(10, 16);
        f.editor.dispatchCommand(CREATE_DRAFT_COMMENT_COMMAND, undefined);
      },
      { discrete: true }
    );
    const secondId = f.state.comments.threads[DRAFT_THREAD_ID]!.anchorId;
    expect(secondId).not.toBe(firstId);
    finish(true);
    expect(await firstPost).toBeNull();
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.removePublished).toHaveBeenCalledWith(
      expect.objectContaining({ markId: firstId })
    );
    expect(f.state.comments.threads[DRAFT_THREAD_ID]?.anchorId).toBe(secondId);
  });

  it.each([false, true])(
    'handles cancellation after message failure, outcome uncertain: %s',
    async (uncertain) => {
      const f = setup();
      f.editor.update(
        () => {
          const text = $createTextNode('Selected passage');
          $getRoot().append($createParagraphNode().append(text));
          text.select(0, 8);
        },
        { discrete: true }
      );
      await f.synchronize();
      f.editor.update(
        () => {
          f.editor.dispatchCommand(CREATE_DRAFT_COMMENT_COMMAND, undefined);
        },
        { discrete: true }
      );
      const anchorId = f.state.comments.threads[DRAFT_THREAD_ID]!.anchorId;
      if (uncertain)
        mocks.post.mockRejectedValueOnce(new Error('response lost'));
      else mocks.post.mockResolvedValueOnce(null);
      const post = f.post({
        threadId: DRAFT_THREAD_ID,
        content: 'Unsent message',
      });
      if (uncertain) {
        await expect(post).rejects.toThrow('response lost');
        f.state.setCommentState('activeCommentThread', null);
        expect(mocks.removePublished).not.toHaveBeenCalled();
        return;
      }
      expect(await post).toBeNull();
      let finishRemoval!: () => void;
      const removed = new Promise<void>((resolve) => {
        finishRemoval = resolve;
      });
      mocks.removePublished.mockImplementationOnce(async () => {
        finishRemoval();
        return true;
      });
      f.state.setCommentState('activeCommentThread', null);
      await removed;
      expect(mocks.removePublished).toHaveBeenCalledWith(
        expect.objectContaining({ markId: anchorId })
      );
    }
  );

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
        await f.synchronize();
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
    await f.synchronize();
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
  it('reads the current quoted text after an edit inside the draft range', async () => {
    const f = setup();
    f.editor.update(
      () => {
        const text = $createTextNode('before ');
        $getRoot().append($createParagraphNode().append(text));
        text.select(0, 6);
      },
      { discrete: true }
    );
    await f.synchronize();
    f.editor.update(
      () => {
        expect(
          f.editor.dispatchCommand(CREATE_DRAFT_COMMENT_COMMAND, undefined)
        ).toBe(true);
      },
      { discrete: true }
    );
    const draft = f.state.comments.threads[DRAFT_THREAD_ID];
    if (!draft) throw new Error('Missing draft thread');
    const publication = f.state.comments.marks[draft.anchorId]?.publication;
    expect(publication?.text()).toBe('before');

    f.editor.update(
      () => {
        const text = $getRoot().getAllTextNodes()[0];
        text.select(3, 3);
        text.spliceText(3, 0, 'Z');
      },
      { discrete: true }
    );
    await f.synchronize();
    expect(publication?.text()).toBe('befZore');
    expect(f.state.comments.threads[DRAFT_THREAD_ID]?.anchorId).toBe(
      draft.anchorId
    );
  });

  it('keeps a draft spanning paragraphs outside the document tree', async () => {
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
      },
      { discrete: true }
    );
    await f.synchronize();
    f.editor.update(
      () => {
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
    ).toHaveLength(1);
    expect(f.state.comments.marks[draft!.anchorId]!.publication?.text()).toBe(
      'First paragraph\nLast'
    );
    expect(f.editor.getRootElement()?.querySelectorAll('mark')).toHaveLength(0);
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
      await f.synchronize();
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
        0
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
