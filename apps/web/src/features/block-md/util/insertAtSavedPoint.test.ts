import {
  $createListItemNode,
  $createListNode,
  $isListNode,
  ListItemNode,
  ListNode,
} from '@lexical/list';
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

function insert(
  editor: LexicalEditor,
  point: SavedPoint,
  label = '[task]'
): SavedPoint | null {
  let next: SavedPoint | null = null;
  editor.update(
    () => {
      // Token text never merges with its neighbours, like a mention chip.
      next = $insertAtSavedPoint(point, [
        $createTextNode(label).setMode('token'),
      ]);
    },
    { discrete: true }
  );
  return next;
}

const text = (editor: LexicalEditor) =>
  editor.read(() => $getRoot().getTextContent());

function checklist(): { editor: LexicalEditor; key: string } {
  const editor = createEditor({
    nodes: [ListNode, ListItemNode],
    onError: (error) => {
      throw error;
    },
  });
  let key = '';
  editor.update(
    () => {
      const list = $createListNode('check');
      key = list.getKey();
      for (const item of ['a', 'b', 'c']) {
        list.append($createListItemNode(false).append($createTextNode(item)));
      }
      $getRoot().append(list);
    },
    { discrete: true }
  );
  return { editor, key };
}

const itemTexts = (editor: LexicalEditor) =>
  editor.read(() =>
    $getRoot()
      .getChildren()
      .flatMap((list) => ($isListNode(list) ? list.getChildren() : []))
      .map((item) => item.getTextContent())
  );

describe('$insertAtSavedPoint', () => {
  it('inserts at the saved point, not at the live selection', () => {
    const { editor, key } = editorWithText('buy milk today.');

    expect(insert(editor, { key, offset: 14, type: 'text' })).not.toBeNull();

    expect(text(editor)).toBe('buy milk today[task].');
  });

  it('keeps successive inserts in creation order via the returned point', () => {
    const { editor, key } = editorWithText('buy milk today.');

    const next = insert(editor, { key, offset: 14, type: 'text' }, '[one]');
    if (!next) throw new Error('first insert failed');
    insert(editor, next, '[two]');

    expect(text(editor)).toBe('buy milk today[one][two].');
  });

  it('inserts at the start and end of a text node', () => {
    const start = editorWithText('today');
    insert(start.editor, { key: start.key, offset: 0, type: 'text' });
    expect(text(start.editor)).toBe('[task]today');

    const end = editorWithText('today');
    insert(end.editor, { key: end.key, offset: 5, type: 'text' });
    expect(text(end.editor)).toBe('today[task]');
  });

  it('links after the item text when the point sits between checklist items', () => {
    const { editor, key } = checklist();

    expect(insert(editor, { key, offset: 2, type: 'element' })).not.toBeNull();

    expect(itemTexts(editor)).toEqual(['a', 'b[task]', 'c']);
  });

  it('adds no list items when the point is before the first item', () => {
    const { editor, key } = checklist();

    expect(insert(editor, { key, offset: 0, type: 'element' })).toBeNull();

    expect(itemTexts(editor)).toEqual(['a', 'b', 'c']);
  });

  it('returns null when the saved node was removed', () => {
    const { editor, key } = editorWithText('today');
    editor.update(
      () => {
        const node = $getRoot().getFirstDescendant();
        if ($isTextNode(node)) node.remove();
      },
      { discrete: true }
    );

    expect(insert(editor, { key, offset: 2, type: 'text' })).toBeNull();
  });
});
