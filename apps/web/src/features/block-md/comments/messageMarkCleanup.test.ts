// @vitest-environment jsdom
import {
  commentPlugin,
  REMOVE_ORPHANED_COMMENT_MARKS_COMMAND,
} from '@core/component/LexicalMarkdown/plugins/comments/commentPlugin';
import { $createCommentNode, CommentNode } from '@macro-inc/lexical-core';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $nodesOfType,
  createEditor,
  type LexicalEditor,
} from 'lexical';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The comment plugin barrel's leaves open the storage and connection-gateway
// sockets on import, which throw under jsdom; stub them like utils.test.ts does.
vi.mock('@service-storage/websocket', () => ({
  storageWS: { reconnectIfDisconnected: vi.fn() },
  createWebSocketJob: vi.fn(),
}));
vi.mock('@service-connection/websocket', () => ({
  ws: { addEventListener: vi.fn(), send: vi.fn() },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect: vi.fn(),
  createConnectionWebsocketEffect: vi.fn(),
}));

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function setup() {
  const editor = createEditor({
    namespace: 'message-mark-cleanup',
    nodes: [CommentNode],
    onError: (error) => {
      throw error;
    },
  });
  const el = document.createElement('div');
  document.body.append(el);
  editor.setRootElement(el);
  disposers.push(
    commentPlugin({
      peerId: () => '1',
      ops: {
        add: () => {},
        init: () => {},
        setActiveIds: () => {},
        remove: () => {},
      },
    })(editor)
  );
  disposers.push(() => {
    editor.setRootElement(null);
    el.remove();
  });
  return editor;
}

function addCommittedMark(
  editor: LexicalEditor,
  params: { id: string; threadId?: number }
) {
  editor.update(
    () => {
      const mark = $createCommentNode({
        ids: [params.id],
        threadId: params.threadId,
        isDraft: false,
      });
      mark.append($createTextNode(`text ${params.id}`));
      $getRoot().append($createParagraphNode().append(mark));
    },
    { discrete: true }
  );
}

function commentMarkIds(editor: LexicalEditor): string[] {
  return editor
    .getEditorState()
    .read(() => $nodesOfType(CommentNode).flatMap((node) => node.getIDs()));
}

describe('legacy orphan-mark cleanup and message-backed marks', () => {
  // The legacy reconciliation's valid set never contains message-backed marks,
  // so an empty set stands in for "none of these ids are known to legacy".
  const noLegacyMarks = new Set<string>();

  it('keeps a committed message mark that carries no stored thread id', async () => {
    const editor = setup();
    addCommittedMark(editor, { id: 'msg' });
    editor.dispatchCommand(
      REMOVE_ORPHANED_COMMENT_MARKS_COMMAND,
      noLegacyMarks
    );
    // A control mark proves the cleanup ran; the message mark must survive it.
    addCommittedMark(editor, { id: 'legacy', threadId: 42 });
    editor.dispatchCommand(
      REMOVE_ORPHANED_COMMENT_MARKS_COMMAND,
      noLegacyMarks
    );
    await vi.waitFor(() => expect(commentMarkIds(editor)).toEqual(['msg']));
  });

  it('keeps a message mark saved before commit cleared the -1 draft sentinel', async () => {
    const editor = setup();
    addCommittedMark(editor, { id: 'old', threadId: -1 });
    editor.dispatchCommand(
      REMOVE_ORPHANED_COMMENT_MARKS_COMMAND,
      noLegacyMarks
    );
    await vi.waitFor(() => expect(commentMarkIds(editor)).toEqual(['old']));
  });

  it('still strips a legacy mark whose numeric thread id is no longer valid', async () => {
    const editor = setup();
    addCommittedMark(editor, { id: 'legacy', threadId: 42 });
    editor.dispatchCommand(
      REMOVE_ORPHANED_COMMENT_MARKS_COMMAND,
      noLegacyMarks
    );
    await vi.waitFor(() => expect(commentMarkIds(editor)).toEqual([]));
  });
});
