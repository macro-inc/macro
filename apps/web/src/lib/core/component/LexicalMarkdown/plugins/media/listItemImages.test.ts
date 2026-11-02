import {
  $createListItemNode,
  $createListNode,
  $isListItemNode,
  $isListNode,
  registerList,
} from '@lexical/list';
import { mergeRegister } from '@lexical/utils';
import { $createImageNode, SupportedNodeTypes } from '@macro-inc/lexical-core';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  createEditor,
  INSERT_PARAGRAPH_COMMAND,
  type LexicalEditor,
} from 'lexical';
import { afterEach, describe, expect, it } from 'vitest';
import {
  $insertImageIntoListItem,
  registerListItemImages,
} from './listItemImages';

const unmounts: Array<() => void> = [];

afterEach(() => {
  for (const unmount of unmounts.splice(0)) unmount();
});

/** A numbered list from `items`; `''` is an empty item. The caret ends on `caretItem`. */
function mountList(items: string[], caretItem: number) {
  const editor = createEditor({
    nodes: SupportedNodeTypes,
    onError(error) {
      throw error;
    },
  });
  const unregister = mergeRegister(
    registerList(editor),
    registerListItemImages(editor)
  );
  const element = document.createElement('div');
  element.contentEditable = 'true';
  document.body.append(element);
  editor.setRootElement(element);
  unmounts.push(() => {
    unregister();
    editor.setRootElement(null);
    element.remove();
  });
  editor.update(
    () => {
      const list = $createListNode('number');
      for (const text of items) {
        const item = $createListItemNode();
        if (text) item.append($createTextNode(text));
        list.append(item);
      }
      $getRoot().clear().append(list);
      list.getChildAtIndex(caretItem)?.selectEnd();
    },
    { discrete: true }
  );
  return editor;
}

function insertImage(editor: LexicalEditor) {
  let inserted = false;
  editor.update(
    () => {
      inserted = $insertImageIntoListItem(
        $createImageNode({ srcType: 'url', url: 'https://example.com/a.png' })
      );
    },
    { discrete: true }
  );
  return inserted;
}

function pressEnter(editor: LexicalEditor) {
  editor.update(
    () => {
      editor.dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined);
    },
    { discrete: true }
  );
}

/** Each top-level block, with each list item's value and child types. */
function outline(editor: LexicalEditor) {
  return editor.read(() =>
    $getRoot()
      .getChildren()
      .map((block) =>
        $isListNode(block)
          ? block
              .getChildren()
              .filter($isListItemNode)
              .map((item) => [
                item.getValue(),
                ...item.getChildren().map((child) => child.getType()),
              ])
          : block.getType()
      )
  );
}

function caretItemIndex(editor: LexicalEditor) {
  return editor.read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return null;
    const node = selection.anchor.getNode();
    return $isListItemNode(node) ? node.getIndexWithinParent() : null;
  });
}

describe('images in lists', () => {
  it('puts an image under the item the caret is in without splitting the list', () => {
    const editor = mountList(['first', 'second'], 0);

    expect(insertImage(editor)).toBe(true);

    expect(outline(editor)).toEqual([
      [
        [1, 'text', 'image'],
        [2, 'text'],
      ],
    ]);
  });

  it('attaches an image on the empty item Enter left to the item above, and a second Enter still leaves the list', () => {
    const editor = mountList(['first', ''], 1);

    expect(insertImage(editor)).toBe(true);

    expect(outline(editor)).toEqual([[[1, 'text', 'image'], [2]]]);
    expect(caretItemIndex(editor)).toBe(1);

    pressEnter(editor);

    expect(outline(editor)).toEqual([[[1, 'text', 'image']], 'paragraph']);
  });

  it('leaves an image outside a list when the caret is not in one', () => {
    const editor = mountList(['first'], 0);
    editor.update(
      () => {
        const paragraph = $createParagraphNode();
        $getRoot().append(paragraph);
        paragraph.select();
      },
      { discrete: true }
    );

    expect(insertImage(editor)).toBe(false);
  });

  it('starts the next item below the images on Enter', () => {
    const editor = mountList(['first', 'second'], 0);
    insertImage(editor);

    pressEnter(editor);

    expect(outline(editor)).toEqual([[[1, 'text', 'image'], [2], [3, 'text']]]);
    expect(caretItemIndex(editor)).toBe(1);
  });
});
