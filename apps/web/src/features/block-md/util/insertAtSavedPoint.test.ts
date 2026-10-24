import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $isTextNode,
  createEditor,
  type LexicalEditor,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import { $insertAtSavedPoint, type SavedPoint } from './insertAtSavedPoint';

function editorWithText(text: string): {
  editor: LexicalEditor;
  key: string;
} {
  const editor = createEditor({
    onError: (error) => {
      throw error;
    },
  });
  let key = '';
  editor.update(
    () => {
      const textNode = $createTextNode(text);
      key = textNode.getKey();
      $getRoot().append($createParagraphNode().append(textNode));
      // The live caret sits at the start, away from the saved point.
      textNode.select(0, 0);
    },
    { discrete: true }
  );
  return { editor, key };
}

function insert(editor: LexicalEditor, point: SavedPoint) {
  let inserted = false;
  editor.update(
    () => {
      inserted = $insertAtSavedPoint(point, [$createTextNode('[task]')]);
    },
    { discrete: true }
  );
  return inserted;
}

const text = (editor: LexicalEditor) =>
  editor.read(() => $getRoot().getTextContent());

describe('$insertAtSavedPoint', () => {
  it('inserts at the saved point, not at the live selection', () => {
    const { editor, key } = editorWithText('buy milk today.');

    expect(insert(editor, { key, offset: 14, type: 'text' })).toBe(true);

    expect(text(editor)).toBe('buy milk today[task].');
  });

  it('inserts at the start and end of a text node', () => {
    const start = editorWithText('today');
    insert(start.editor, { key: start.key, offset: 0, type: 'text' });
    expect(text(start.editor)).toBe('[task]today');

    const end = editorWithText('today');
    insert(end.editor, { key: end.key, offset: 5, type: 'text' });
    expect(text(end.editor)).toBe('today[task]');
  });

  it('returns false when the saved node was removed', () => {
    const { editor, key } = editorWithText('today');
    editor.update(
      () => {
        const node = $getRoot().getFirstDescendant();
        if ($isTextNode(node)) node.remove();
      },
      { discrete: true }
    );

    expect(insert(editor, { key, offset: 2, type: 'text' })).toBe(false);
  });
});
