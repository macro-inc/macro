import { createHeadlessEditor } from '@lexical/headless';
import {
  $createParagraphNode,
  $createRangeSelection,
  $createTextNode,
  $getRoot,
  $getSelection,
  $setSelection,
  ElementNode,
} from 'lexical';
import { expect, test } from 'vitest';

class NonEmptyBlock extends ElementNode {
  static getType() {
    return 'non-empty-block';
  }
  static clone(node: NonEmptyBlock) {
    return new NonEmptyBlock(node.__key);
  }
  createDOM() {
    return document.createElement('div');
  }
  updateDOM() {
    return false;
  }
  canBeEmpty() {
    return false;
  }
}
test('upstream caret remains outside a removed nonempty block', () => {
  const editor = createHeadlessEditor({
    namespace: 'caret-test',
    nodes: [NonEmptyBlock],
    onError(error) {
      throw error;
    },
  });
  editor.update(
    () => {
      const previous = $createParagraphNode().append($createTextNode('left'));
      const token = $createTextNode('x').setMode('token');
      const removed = new NonEmptyBlock().append(token);
      const right = $createTextNode('right');
      const next = $createParagraphNode().append(right);
      $getRoot().append(previous, removed, next);
      const selection = $createRangeSelection();
      selection.anchor.set(token.getKey(), 0, 'text');
      selection.focus.set(right.getKey(), 1, 'text');
      $setSelection(selection);
      selection.removeText();
    },
    { discrete: true }
  );
  editor.getEditorState().read(() => {
    expect(
      $getRoot()
        .getChildren()
        .map((node) => node.getTextContent())
    ).toEqual(['left', 'ight']);
    const selection = $getSelection();
    expect(selection).toMatchObject({
      anchor: { key: 'root', offset: 1, type: 'element' },
      focus: { key: 'root', offset: 1, type: 'element' },
    });
  });
});
