import { $createCommentNode, CommentNode } from '@macro-inc/lexical-core';
import {
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $setSelection,
  createEditor,
} from 'lexical';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commentPlugin, MARK_SELECTED_COMMENT_COMMAND } from './commentPlugin';

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function setup() {
  const editor = createEditor({
    namespace: 'comment-plugin',
    nodes: [CommentNode],
    onError: (error) => {
      throw error;
    },
  });
  const root = document.createElement('div');
  root.contentEditable = 'true';
  document.body.append(root);
  editor.setRootElement(root);
  const setActiveIds = vi.fn<(ids: string[]) => void>();
  disposers.push(
    commentPlugin({
      peerId: () => '1',
      ops: { add: () => {}, init: () => {}, remove: () => {}, setActiveIds },
    })(editor)
  );
  disposers.push(() => {
    editor.setRootElement(null);
    root.remove();
  });
  return { editor, root, setActiveIds };
}

describe('commentPlugin', () => {
  it('selects the comment under an unmoved caret again when the editor is clicked', () => {
    const { editor, root, setActiveIds } = setup();
    editor.update(
      () => {
        const commented = $createTextNode('world');
        $getRoot().append(
          $createParagraphNode().append(
            $createTextNode('hello '),
            $createCommentNode({ ids: ['mark'] }).append(commented)
          )
        );
        const selection = $createRangeSelection();
        selection.anchor.set(commented.getKey(), 2, 'text');
        selection.focus.set(commented.getKey(), 2, 'text');
        $setSelection(selection);
      },
      { discrete: true }
    );
    expect(setActiveIds).toHaveBeenLastCalledWith(['mark']);

    // The thread is closed from outside the editor; the caret stays put.
    editor.dispatchCommand(MARK_SELECTED_COMMENT_COMMAND, []);
    expect(setActiveIds).toHaveBeenLastCalledWith([]);

    root.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(setActiveIds).toHaveBeenLastCalledWith(['mark']);
  });
});
