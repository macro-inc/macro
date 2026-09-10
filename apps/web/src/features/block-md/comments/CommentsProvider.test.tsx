import type { LoroManager } from '@macro-inc/collaboration/collab/manager';
import { $createCommentNode, CommentNode } from '@macro-inc/lexical-core';
import type { MessageListItem, MessageThread } from '@service-storage/messages';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  createEditor,
  type LexicalEditor,
} from 'lexical';
import { createSignal } from 'solid-js';
import { reconcile } from 'solid-js/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommentsProvider } from './CommentsProvider';
import {
  activeCommentThreadSignal,
  activeMarkIdsSignal,
  commentMarksInitializedSignal,
  commentsStore,
  markStore,
  threadStore,
} from './commentStore';

let editor: LexicalEditor;
let canEdit = true;
let canComment = true;
let updateThread:
  | ((parent: unknown, state: MessageThread['state']) => void)
  | undefined;
const [roots, setRoots] = createSignal<MessageListItem[]>([]);
const patch = vi.fn();

vi.mock('@core/block', () => ({ useBlockId: () => 'document' }));
vi.mock('@core/context/user', () => ({ useUserId: () => () => 'myself' }));
vi.mock('@core/signal/permissions', () => ({
  useCanEdit: () => () => canEdit,
  useCanComment: () => () => canComment,
}));
vi.mock('@queries/messages', () => ({
  useMessageLink: () => ({ messageId: () => null, rootId: () => null }),
}));
vi.mock('@queries/messages/mutations', () => ({
  usePatchThreadMutation: () => ({ mutate: patch }),
}));
vi.mock('@queries/messages/sync', () => ({
  onThreadStateUpdated: (listener: typeof updateThread) => {
    updateThread = listener;
    return () => {
      updateThread = undefined;
    };
  },
}));
vi.mock('./commentsResource', () => ({
  documentMessagesQuery: () => ({
    isSuccess: true,
    get data() {
      return roots();
    },
  }),
}));
vi.mock('./commentOperations', () => ({
  useDeleteNewComments: () => () => {},
}));
vi.mock('@core/component/LexicalMarkdown/utils', () => ({
  $traverseNodes: vi.fn(),
}));
vi.mock('@core/component/LexicalMarkdown/plugins', async () => {
  const { onCleanup } = await import('solid-js');
  return { autoRegister: onCleanup };
});
vi.mock(
  '@core/component/LexicalMarkdown/context/LexicalWrapperContext',
  async () => {
    const { createContext, onCleanup } = await import('solid-js');
    return {
      isWrapperWithIds: () => true,
      LexicalWrapperContext: createContext({
        get editor() {
          return editor;
        },
        plugins: {
          use: (plugin: (editor: LexicalEditor) => () => void) =>
            onCleanup(plugin(editor)),
        },
      }),
    };
  }
);
vi.mock('./commentStore', async () => {
  const { createSignal } = await import('solid-js');
  const { createStore } = await import('solid-js/store');
  const signal = <T,>(initial: T) => {
    const [get, set] = createSignal(initial);
    return Object.assign(get, {
      get,
      set,
      [Symbol.iterator]: function* () {
        yield get;
        yield set;
      },
    });
  };
  const store = () => {
    const pair = createStore({});
    return Object.assign(pair, { get: pair[0], set: pair[1] });
  };
  return {
    markStore: store(),
    commentsStore: store(),
    threadStore: store(),
    activeCommentThreadSignal: signal(null),
    activeMarkIdsSignal: signal([]),
    commentMarksInitializedSignal: signal(false),
    highlightedCommentIdSignal: signal(null),
    highlightedCommentThreadsSignal: signal([]),
  };
});

const time = '2026-09-09T00:00:00Z';
const root: MessageListItem = {
  id: 'thread',
  parent: { type: 'document', id: 'document' },
  sender_id: 'myself',
  content: 'Retained comment',
  mentions: [],
  attachments: [],
  reactions: [],
  created_at: time,
  updated_at: time,
  thread: { reply_count: 5, preview: [] },
  state: {
    root_id: 'thread',
    user_id: 'myself',
    resolved: false,
    anchor: { type: 'markdown', mark_id: 'mark' },
    created_at: time,
    updated_at: time,
  },
};
let element: HTMLDivElement;
beforeEach(() => {
  patch.mockClear();
  canEdit = true;
  canComment = true;
  markStore.set(reconcile({}));
  commentsStore.set(reconcile({}));
  threadStore.set(reconcile({}));
  activeCommentThreadSignal.set(null);
  activeMarkIdsSignal.set([]);
  commentMarksInitializedSignal.set(false);
  setRoots([root]);
  editor = createEditor({
    nodes: [CommentNode],
    onError: (error) => {
      throw error;
    },
  });
  element = document.createElement('div');
  document.body.append(element);
  editor.setRootElement(element);
  render(() => (
    <CommentsProvider
      loroManager={{ peerIdStr: '1' } as unknown as LoroManager}
    />
  ));
});
afterEach(() => {
  cleanup();
  editor.setRootElement(null);
  element.remove();
});

function addMark(ids = ['mark']) {
  let key = '';
  editor.update(
    () => {
      const node = $createCommentNode({ ids, isDraft: false });
      key = node.getKey();
      node.append($createTextNode('Selected text'));
      $getRoot().append($createParagraphNode().append(node));
    },
    { discrete: true }
  );
  return key;
}

async function bindMark() {
  const key = addMark();
  await waitFor(() => expect(threadStore.get.thread?.id).toBe('thread'));
  return key;
}

function applyState(state: MessageThread['state']) {
  setRoots(state.deleted_at ? [] : [{ ...root, state }]);
  updateThread?.(root.parent, state);
}

describe('Markdown comment placement lifecycle', () => {
  const tombstone: MessageListItem = {
    ...root,
    content: '',
    deleted_at: time,
    state: { ...root.state, deleted_at: time },
    thread: { reply_count: 0, preview: [] },
  };

  it.each(['metadata first', 'mark first'])(
    'recovers discussion deletion while closed (%s)',
    async (order) => {
      setRoots(order === 'metadata first' ? [tombstone] : []);
      addMark();
      if (order === 'mark first') setRoots([tombstone]);
      await waitFor(() =>
        expect(element.querySelectorAll('mark')).toHaveLength(0)
      );
      expect(element.textContent).toBe('Selected text');
      expect(threadStore.get.thread).toBeUndefined();
      expect(patch).not.toHaveBeenCalled();
    }
  );

  it.each(['metadata first', 'mark first'])(
    'hides a deleted highlight for a read-only viewer without changing document data (%s)',
    async (order) => {
      canEdit = false;
      canComment = false;
      setRoots(order === 'metadata first' ? [tombstone] : []);
      addMark();
      const serialized = editor.getEditorState().toJSON();
      if (order === 'mark first') setRoots([tombstone]);
      await waitFor(() =>
        expect(
          element.querySelector('mark')?.hasAttribute('data-comment-inactive')
        ).toBe(true)
      );
      expect(editor.getEditorState().toJSON()).toEqual(serialized);
      expect(element.textContent).toBe('Selected text');
      expect(threadStore.get.thread).toBeUndefined();
      expect(patch).not.toHaveBeenCalled();
    }
  );

  it.each(['unloaded', 'live', 'deleted'])(
    'preserves overlapping %s comments for read-only viewers',
    async (otherState) => {
      canEdit = false;
      canComment = false;
      const other: MessageListItem = {
        ...root,
        id: 'other-thread',
        state: {
          ...root.state,
          root_id: 'other-thread',
          anchor: { type: 'markdown', mark_id: 'other-mark' },
          deleted_at: otherState === 'deleted' ? time : undefined,
        },
      };
      setRoots(otherState === 'unloaded' ? [tombstone] : [tombstone, other]);
      addMark(['mark', 'other-mark']);
      const serialized = editor.getEditorState().toJSON();
      await waitFor(() =>
        expect(
          element.querySelector('mark')?.hasAttribute('data-comment-inactive')
        ).toBe(otherState === 'deleted')
      );
      expect(editor.getEditorState().toJSON()).toEqual(serialized);
      expect(patch).not.toHaveBeenCalled();
    }
  );

  it('restores highlight styling when a newer live discussion reuses a deleted mark', async () => {
    canEdit = false;
    canComment = false;
    setRoots([tombstone]);
    addMark();
    await waitFor(() =>
      expect(
        element.querySelector('mark')?.hasAttribute('data-comment-inactive')
      ).toBe(true)
    );
    setRoots([
      tombstone,
      {
        ...root,
        id: 'new-thread',
        state: { ...root.state, root_id: 'new-thread' },
      },
    ]);
    await waitFor(() =>
      expect(
        element.querySelector('mark')?.hasAttribute('data-comment-inactive')
      ).toBe(false)
    );
    expect(threadStore.get['new-thread']?.id).toBe('new-thread');
    expect(patch).not.toHaveBeenCalled();
  });

  it('cleans a live deletion before the paginated root binds', async () => {
    setRoots([]);
    addMark();
    updateThread?.(root.parent, tombstone.state);
    await waitFor(() =>
      expect(element.querySelectorAll('mark')).toHaveLength(0)
    );
    expect(element.textContent).toBe('Selected text');
    expect(patch).not.toHaveBeenCalled();
  });

  it('cleans persisted marks already present when the comment plugin mounts', async () => {
    await bindMark();
    cleanup();
    markStore.set(reconcile({}));
    setRoots([tombstone]);
    render(() => (
      <CommentsProvider
        loroManager={{ peerIdStr: '1' } as unknown as LoroManager}
      />
    ));
    await waitFor(() =>
      expect(element.querySelectorAll('mark')).toHaveLength(0)
    );
    expect(element.textContent).toBe('Selected text');
    expect(patch).not.toHaveBeenCalled();
  });

  it('preserves a mark owned by a newer live discussion', async () => {
    setRoots([
      {
        ...root,
        id: 'new-thread',
        state: { ...root.state, root_id: 'new-thread' },
      },
      tombstone,
    ]);
    addMark();
    await waitFor(() =>
      expect(threadStore.get['new-thread']?.id).toBe('new-thread')
    );
    expect(element.querySelectorAll('mark')).toHaveLength(1);
    expect(patch).not.toHaveBeenCalled();
  });

  it('detaches the retained thread only after its final marked text is deleted', async () => {
    const key = await bindMark();
    editor.update(() => $getNodeByKey(key)?.remove(), { discrete: true });
    expect(patch).toHaveBeenCalledExactlyOnceWith({
      parent: root.parent,
      rootId: 'thread',
      patch: { detach_anchor: true },
    });
  });

  it('does not remove marks or detach threads based on missing paginated roots', async () => {
    setRoots([]);
    addMark();
    expect(element.querySelectorAll('mark')).toHaveLength(1);
    expect(patch).not.toHaveBeenCalled();
    setRoots([root]);
    await waitFor(() => expect(threadStore.get.thread?.replyCount).toBe(5));
    setRoots([]);
    expect(element.querySelectorAll('mark')).toHaveLength(1);
    expect(threadStore.get.thread?.id).toBe('thread');
    expect(patch).not.toHaveBeenCalled();
  });

  it('clears the local margin binding on an explicit detach without rewriting document text', async () => {
    await bindMark();
    applyState({ ...root.state, anchor: null });
    await waitFor(() => expect(threadStore.get.thread).toBeUndefined());
    expect(element.querySelectorAll('mark')).toHaveLength(1);
    expect(
      element.querySelector('mark')?.hasAttribute('data-comment-inactive')
    ).toBe(true);
    expect(patch).not.toHaveBeenCalled();
  });

  it.each([
    {
      editorAccess: true,
      commenterAccess: true,
      owner: 'other',
      removeMark: true,
    },
    {
      editorAccess: false,
      commenterAccess: true,
      owner: 'myself',
      removeMark: true,
    },
    {
      editorAccess: false,
      commenterAccess: true,
      owner: 'other',
      removeMark: false,
    },
    {
      editorAccess: false,
      commenterAccess: false,
      owner: 'myself',
      removeMark: false,
    },
  ])(
    'cleans explicit thread deletion with permission $editorAccess/$commenterAccess/$owner',
    async ({ editorAccess, commenterAccess, owner, removeMark }) => {
      canEdit = editorAccess;
      canComment = commenterAccess;
      await bindMark();
      applyState({
        ...root.state,
        user_id: owner,
        anchor: null,
        deleted_at: time,
      });
      await waitFor(() => expect(threadStore.get.thread).toBeUndefined());
      await waitFor(() =>
        expect(element.querySelectorAll('mark')).toHaveLength(
          removeMark ? 0 : 1
        )
      );
      expect(element.textContent).toBe('Selected text');
      if (!removeMark)
        expect(
          element.querySelector('mark')?.hasAttribute('data-comment-inactive')
        ).toBe(true);
      expect(patch).not.toHaveBeenCalled();
    }
  );
});
