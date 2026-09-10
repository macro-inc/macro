import {
  commentPlugin,
  DELETE_COMMENT_COMMAND,
} from '@core/component/LexicalMarkdown/plugins/comments/commentPlugin';
import { $createCommentNode, CommentNode } from '@macro-inc/lexical-core';
import {
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COLLABORATION_TAG,
  createEditor,
  type LexicalEditor,
} from 'lexical';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@core/component/LexicalMarkdown/utils', () => ({
  $traverseNodes: vi.fn(),
}));

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function setup(
  onAdd?: (editor: LexicalEditor, id: string) => void,
  beforeRegister?: (editor: LexicalEditor) => void
) {
  const editor = createEditor({
    namespace: 'comment-mark-removal',
    nodes: [CommentNode],
    onError: (error) => {
      throw error;
    },
  });
  const el = document.createElement('div');
  document.body.append(el);
  editor.setRootElement(el);
  beforeRegister?.(editor);
  const removed = vi.fn();
  disposers.push(
    commentPlugin({
      peerId: () => '1',
      ops: {
        add: (id) => onAdd?.(editor, id),
        init: () => {},
        setActiveIds: () => {},
        remove: (id, _key, lastRangeRemoved) => {
          if (lastRangeRemoved) removed([id]);
        },
      },
    })(editor)
  );
  disposers.push(() => {
    editor.setRootElement(null);
    el.remove();
  });
  return { editor, removed };
}

function addRange(editor: LexicalEditor, id = 'mark') {
  let key = '';
  editor.update(
    () => {
      const mark = $createCommentNode({ ids: [id], isDraft: false });
      key = mark.getKey();
      mark.append($createTextNode('Selected text'));
      $getRoot().append($createParagraphNode().append(mark));
    },
    { discrete: true }
  );
  return key;
}

describe('comment mark removal', () => {
  it.each([false, true])(
    'can clean a server-deleted mark during discovery (already mounted: %s)',
    async (alreadyMounted) => {
      const handled = vi.fn();
      const { editor } = setup(
        (editor, id) =>
          handled(editor.dispatchCommand(DELETE_COMMENT_COMMAND, [id, true])),
        alreadyMounted ? (editor) => addRange(editor) : undefined
      );
      if (!alreadyMounted) addRange(editor);
      expect(handled).toHaveBeenCalledWith(true);
      await vi.waitFor(() =>
        expect(editor.getRootElement()?.querySelectorAll('mark')).toHaveLength(
          0
        )
      );
      expect(editor.getRootElement()?.textContent).toBe('Selected text');
    }
  );

  it('reports the last removed range, including a collaborator edit', () => {
    const { editor, removed } = setup();
    const key = addRange(editor);
    editor.update(() => $getNodeByKey(key)?.remove(), {
      discrete: true,
      tag: COLLABORATION_TAG,
    });
    expect(removed).toHaveBeenCalledExactlyOnceWith(['mark']);
  });

  it('reports deletion of all selected marked text', () => {
    const { editor, removed } = setup();
    const key = addRange(editor);
    editor.update(
      () => {
        const text = ($getNodeByKey(key) as CommentNode).getFirstChild();
        if (!$isTextNode(text)) throw new Error('Expected a marked text node');
        text.select(0, text.getTextContentSize());
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) throw new Error('Expected a range');
        selection.removeText();
      },
      { discrete: true }
    );
    expect(removed).toHaveBeenCalledExactlyOnceWith(['mark']);
  });

  it('keeps a thread anchored while another range with its ID exists', () => {
    const { editor, removed } = setup();
    const first = addRange(editor);
    const second = addRange(editor);
    editor.update(() => $getNodeByKey(first)?.remove(), { discrete: true });
    expect(removed).not.toHaveBeenCalled();
    editor.update(() => $getNodeByKey(second)?.remove(), { discrete: true });
    expect(removed).toHaveBeenCalledExactlyOnceWith(['mark']);
  });

  it('does not mistake node replacement in one update for range deletion', () => {
    const { editor, removed } = setup();
    const key = addRange(editor);
    editor.update(
      () => {
        const replacement = $createCommentNode({
          ids: ['mark'],
          isDraft: false,
        });
        replacement.append($createTextNode('Updated text'));
        $getNodeByKey(key)?.replace(replacement);
      },
      { discrete: true }
    );
    expect(removed).not.toHaveBeenCalled();
  });

  it('does not infer deletion from initialization or view unmounting', () => {
    const { editor, removed } = setup();
    addRange(editor);
    editor.setRootElement(null);
    expect(removed).not.toHaveBeenCalled();
  });

  it('deletes only the requested thread when comments overlap', () => {
    const { editor, removed } = setup();
    const key = addRange(editor);
    editor.update(
      () => ($getNodeByKey(key) as CommentNode).addID('other-comment'),
      { discrete: true }
    );
    editor.update(
      () => editor.dispatchCommand(DELETE_COMMENT_COMMAND, ['mark', true]),
      { discrete: true }
    );
    expect(removed).toHaveBeenCalledExactlyOnceWith(['mark']);
    editor.getEditorState().read(() => {
      const mark = $getNodeByKey(key) as CommentNode;
      expect(mark.getIDs()).toEqual(['other-comment']);
      expect(mark.getTextContent()).toBe('Selected text');
    });
  });
});
