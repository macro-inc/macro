import { createEmptyHistoryState, registerHistory } from '@lexical/history';
import {
  $createListItemNode,
  $createListNode,
  $isListItemNode,
  $isListNode,
  ListItemNode,
  ListNode,
  type ListType,
  registerList,
} from '@lexical/list';
import { registerRichText } from '@lexical/rich-text';
import {
  $createTextNode,
  $getRoot,
  $getSelection,
  createEditor,
  type LexicalEditor,
  REDO_COMMAND,
  UNDO_COMMAND,
} from 'lexical';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  $indentListItem,
  $outdentListItem,
  listSwipeIndentPlugin,
} from './listSwipeIndentPlugin';

class PolyfillPointerEvent extends MouseEvent {
  pointerId: number;
  pointerType: string;
  isPrimary: boolean;
  constructor(
    type: string,
    init: MouseEventInit & {
      pointerId?: number;
      pointerType?: string;
      isPrimary?: boolean;
    } = {}
  ) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.pointerType = init.pointerType ?? '';
    this.isPrimary = init.isPrimary ?? true;
  }
}
if (typeof globalThis.PointerEvent === 'undefined') {
  globalThis.PointerEvent =
    PolyfillPointerEvent as unknown as typeof PointerEvent;
}

function createTestEditorWithCleanup(isInteractable = () => true) {
  const editor = createEditor({
    namespace: 'list-swipe-indent-test',
    nodes: [ListNode, ListItemNode],
    onError: (error) => {
      throw error;
    },
  });
  const root = document.createElement('div');
  root.contentEditable = 'true';
  document.body.appendChild(root);
  editor.setRootElement(root);
  registerRichText(editor);
  const unregister = listSwipeIndentPlugin(isInteractable)(editor);
  return { editor, unregister };
}

function createTestEditor(isInteractable = () => true): LexicalEditor {
  return createTestEditorWithCleanup(isInteractable).editor;
}

function $buildList(
  items: Array<{ text: string; indent?: number }>,
  listType: ListType = 'bullet'
) {
  const list = $createListNode(listType);
  const nodes = items.map((item) => {
    const node = $createListItemNode();
    node.append($createTextNode(item.text));
    list.append(node);
    return node;
  });
  $getRoot().clear().append(list);
  // Apply indent after attach so ListItemNode.setIndent can rewrite the tree.
  nodes.forEach((node, index) => {
    const indent = items[index].indent;
    if (indent) node.setIndent(indent);
  });
}

function readIndents(editor: LexicalEditor): number[] {
  return editor.getEditorState().read(() =>
    $getRoot()
      .getAllTextNodes()
      .map((text) => {
        const parent = text.getParent();
        return $isListItemNode(parent) ? parent.getIndent() : -1;
      })
  );
}

function itemElement(editor: LexicalEditor, text: string): HTMLElement {
  return editor.getEditorState().read(() => {
    const textNode = $getRoot()
      .getAllTextNodes()
      .find((node) => node.getTextContent() === text);
    if (!textNode) throw new Error(`no text node "${text}"`);
    const item = textNode.getParent();
    if (!$isListItemNode(item)) throw new Error(`"${text}" is not a list item`);
    const elem = editor.getElementByKey(item.getKey());
    if (!elem) throw new Error(`no element for "${text}"`);
    return elem;
  });
}

function pointerEvent(
  type: string,
  init: {
    clientX?: number;
    clientY?: number;
    pointerType?: string;
  } = {}
): PointerEvent {
  return new PolyfillPointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX ?? 80,
    clientY: init.clientY ?? 40,
    isPrimary: true,
    pointerId: 1,
    pointerType: init.pointerType ?? 'touch',
  }) as unknown as PointerEvent;
}

async function update(editor: LexicalEditor, fn: () => void): Promise<void> {
  await new Promise<void>((resolve) => {
    editor.update(fn, { onUpdate: () => resolve() });
  });
}

async function swipe(
  editor: LexicalEditor,
  text: string,
  dx: number,
  dy = 0,
  pointerType = 'touch'
) {
  const elem = itemElement(editor, text);
  const startX = 80;
  const startY = 40;
  elem.dispatchEvent(
    pointerEvent('pointerdown', {
      clientX: startX,
      clientY: startY,
      pointerType,
    })
  );
  const beforeMove = editor.getRootElement()?.innerHTML;
  document.dispatchEvent(
    pointerEvent('pointermove', {
      clientX: startX + dx,
      clientY: startY + dy,
      pointerType,
    })
  );
  // The entire group stays visually unchanged until the finger is released.
  expect(editor.getRootElement()?.innerHTML).toBe(beforeMove);
  document.dispatchEvent(
    pointerEvent('pointerup', {
      clientX: startX + dx,
      clientY: startY + dy,
      pointerType,
    })
  );
  await Promise.resolve();
}

afterEach(() => {
  vi.restoreAllMocks();
  document.dispatchEvent(pointerEvent('pointercancel'));
  document.body.innerHTML = '';
});

describe('list swipe indent cleanup', () => {
  it('removes the document listener and cancels an active swipe when unregistered with a mounted root', async () => {
    const addListener = vi.spyOn(document, 'addEventListener');
    const removeListener = vi.spyOn(document, 'removeEventListener');
    const { editor, unregister } = createTestEditorWithCleanup();
    const pointerDown = addListener.mock.calls.find(
      ([type, , options]) => type === 'pointerdown' && options === true
    )?.[1];
    expect(pointerDown).toBeDefined();
    await update(editor, () => {
      $buildList([{ text: 'one' }, { text: 'two' }]);
    });
    const root = editor.getRootElement();
    itemElement(editor, 'two').dispatchEvent(pointerEvent('pointerdown'));
    document.dispatchEvent(pointerEvent('pointermove', { clientX: 130 }));

    unregister();

    expect(root?.isConnected).toBe(true);
    expect(editor.getRootElement()).toBe(root);
    expect(removeListener).toHaveBeenCalledWith(
      'pointerdown',
      pointerDown,
      true
    );
    const touchMove = new Event('touchmove', { cancelable: true });
    document.dispatchEvent(touchMove);
    expect(touchMove.defaultPrevented).toBe(false);
    document.dispatchEvent(pointerEvent('pointerup', { clientX: 130 }));
    await Promise.resolve();
    expect(readIndents(editor)).toEqual([0, 0]);
    await swipe(editor, 'two', 50);
    expect(readIndents(editor)).toEqual([0, 0]);
  });

  it('removes the previous root listener while enabling swipes on a replacement root', async () => {
    const addListener = vi.spyOn(document, 'addEventListener');
    const removeListener = vi.spyOn(document, 'removeEventListener');
    const { editor, unregister } = createTestEditorWithCleanup();
    const pointerDown = addListener.mock.calls.find(
      ([type, , options]) => type === 'pointerdown' && options === true
    )?.[1];
    expect(pointerDown).toBeDefined();
    await update(editor, () => {
      $buildList([{ text: 'one' }, { text: 'two' }]);
    });
    const root = document.createElement('div');
    root.contentEditable = 'true';
    document.body.appendChild(root);

    editor.setRootElement(root);

    expect(removeListener).toHaveBeenCalledWith(
      'pointerdown',
      pointerDown,
      true
    );
    await swipe(editor, 'two', 50);
    expect(readIndents(editor)).toEqual([0, 1]);
    unregister();
  });
});

describe('$indentListItem / $outdentListItem', () => {
  it('indents an item under the previous sibling', async () => {
    const editor = createTestEditor();
    await update(editor, () => {
      $buildList([{ text: 'one' }, { text: 'two' }]);
      const two = $getRoot()
        .getAllTextNodes()
        .find((node) => node.getTextContent() === 'two')
        ?.getParent();
      if ($isListItemNode(two)) expect($indentListItem(two)).toBe(true);
    });
    expect(readIndents(editor)).toEqual([0, 1]);
  });

  it('indents the only item in a list', async () => {
    const editor = createTestEditor();
    registerList(editor);
    await update(editor, () => {
      $buildList([{ text: 'one' }]);
      const one = $getRoot().getAllTextNodes()[0].getParent();
      if ($isListItemNode(one)) expect($indentListItem(one)).toBe(true);
    });
    expect(readIndents(editor)).toEqual([1]);
  });

  it('outdents a nested item', async () => {
    const editor = createTestEditor();
    await update(editor, () => {
      $buildList([{ text: 'one' }, { text: 'two', indent: 1 }]);
      const two = $getRoot()
        .getAllTextNodes()
        .find((node) => node.getTextContent() === 'two')
        ?.getParent();
      if ($isListItemNode(two)) expect($outdentListItem(two)).toBe(true);
    });
    expect(readIndents(editor)).toEqual([0, 0]);
  });

  it('does not outdent an item already at the root', async () => {
    const editor = createTestEditor();
    await update(editor, () => {
      $buildList([{ text: 'one' }]);
      const one = $getRoot().getAllTextNodes()[0]?.getParent();
      if ($isListItemNode(one)) expect($outdentListItem(one)).toBe(false);
    });
    expect(readIndents(editor)).toEqual([0]);
  });

  it.each(['parent', ''])(
    'outdent fallback preserves parent content %j and removes empty wrappers',
    async (parentText) => {
      const editor = createTestEditor();
      await update(editor, () => {
        const list = $createListNode('bullet');
        const parent = $createListItemNode();
        if (parentText) parent.append($createTextNode(parentText));
        const nested = $createListNode('bullet');
        const child = $createListItemNode().append($createTextNode('child'));
        parent.append(nested.append(child));
        $getRoot().clear().append(list.append(parent));

        // Exercise the fallback for a setIndent call that leaves the tree unchanged.
        const setIndent = vi.spyOn(child, 'setIndent').mockReturnValue(child);
        expect($outdentListItem(child)).toBe(true);
        setIndent.mockRestore();

        expect(nested.isAttached()).toBe(false);
        expect(list.getChildren()).toEqual(
          parentText ? [parent, child] : [child]
        );
      });
      editor.read(() => {
        expect(
          $getRoot()
            .getAllTextNodes()
            .map((node) => node.getTextContent())
        ).toEqual(parentText ? [parentText, 'child'] : ['child']);
      });
      expect(readIndents(editor)).toEqual(parentText ? [0, 0] : [0]);
    }
  );
});

describe('list swipe indent gesture', () => {
  it('does not mutate a comment-only editor that Lexical marks editable', async () => {
    const editor = createTestEditor(() => false);
    await update(editor, () => {
      $buildList([{ text: 'one' }, { text: 'two', indent: 1 }]);
    });
    expect(editor.isEditable()).toBe(true);
    const before = editor.getEditorState().toJSON();
    const updateSpy = vi.spyOn(editor, 'update');

    await swipe(editor, 'two', 50);
    await swipe(editor, 'two', -50);

    expect(updateSpy).not.toHaveBeenCalled();
    expect(editor.getEditorState().toJSON()).toEqual(before);
  });

  it.each(['during swipe', 'after release'] as const)(
    'does not queue an editor update when edit permission is revoked %s',
    async (when) => {
      let canEdit = true;
      const editor = createTestEditor(() => canEdit);
      await update(editor, () => {
        $buildList([{ text: 'one' }, { text: 'two' }]);
      });
      const elem = itemElement(editor, 'two');
      const updateSpy = vi.spyOn(editor, 'update');
      elem.dispatchEvent(pointerEvent('pointerdown'));
      document.dispatchEvent(pointerEvent('pointermove', { clientX: 130 }));
      if (when === 'during swipe') canEdit = false;
      document.dispatchEvent(pointerEvent('pointerup', { clientX: 130 }));
      canEdit = false;
      await Promise.resolve();

      expect(editor.isEditable()).toBe(true);
      expect(updateSpy).not.toHaveBeenCalled();
      expect(readIndents(editor)).toEqual([0, 0]);
    }
  );

  it('requires a new swipe if edit permission is granted after pointer-down', async () => {
    let canEdit = false;
    const editor = createTestEditor(() => canEdit);
    await update(editor, () => {
      $buildList([{ text: 'one' }, { text: 'two' }]);
    });
    itemElement(editor, 'two').dispatchEvent(pointerEvent('pointerdown'));
    canEdit = true;
    document.dispatchEvent(pointerEvent('pointermove', { clientX: 130 }));
    document.dispatchEvent(pointerEvent('pointerup', { clientX: 130 }));
    await Promise.resolve();
    expect(readIndents(editor)).toEqual([0, 0]);

    await swipe(editor, 'two', 50);
    expect(readIndents(editor)).toEqual([0, 1]);
  });

  it('indents a list item on a right swipe', async () => {
    const editor = createTestEditor();
    await update(editor, () => {
      $buildList([{ text: 'one' }, { text: 'two' }]);
    });

    await swipe(editor, 'two', 50);

    expect(readIndents(editor)).toEqual([0, 1]);
  });

  it('outdents a list item on a left swipe', async () => {
    const editor = createTestEditor();
    await update(editor, () => {
      $buildList([{ text: 'one' }, { text: 'two', indent: 1 }]);
    });

    await swipe(editor, 'two', -50);

    expect(readIndents(editor)).toEqual([0, 0]);
  });

  it('does not indent on a vertical swipe', async () => {
    const editor = createTestEditor();
    await update(editor, () => {
      $buildList([{ text: 'one' }, { text: 'two' }]);
    });

    await swipe(editor, 'two', 10, 60);

    expect(readIndents(editor)).toEqual([0, 0]);
  });

  it('does not indent on a mouse drag', async () => {
    const editor = createTestEditor();
    await update(editor, () => {
      $buildList([{ text: 'one' }, { text: 'two' }]);
    });

    await swipe(editor, 'two', 50, 0, 'mouse');

    expect(readIndents(editor)).toEqual([0, 0]);
  });

  it('does not indent when the swipe is shorter than the commit threshold', async () => {
    const editor = createTestEditor();
    await update(editor, () => {
      $buildList([{ text: 'one' }, { text: 'two' }]);
    });

    await swipe(editor, 'two', 20);

    expect(readIndents(editor)).toEqual([0, 0]);
  });

  it('indents the first item without moving the following sibling', async () => {
    const editor = createTestEditor();
    registerList(editor);
    await update(editor, () => {
      $buildList([{ text: 'one' }, { text: 'two' }]);
    });

    await swipe(editor, 'one', 50);

    expect(readIndents(editor)).toEqual([1, 0]);
    await swipe(editor, 'one', -50);
    expect(readIndents(editor)).toEqual([0, 0]);
  });

  it('does not indent when the editor is read-only', async () => {
    const editor = createTestEditor();
    editor.setEditable(false);
    await update(editor, () => {
      $buildList([{ text: 'one' }, { text: 'two' }]);
    });

    await swipe(editor, 'two', 50);

    expect(readIndents(editor)).toEqual([0, 0]);
  });
});

describe('list swipe indent with registerList', () => {
  it('creates a nested list for the group and undoes the move as one edit', async () => {
    const editor = createTestEditor();
    registerList(editor);
    registerHistory(editor, createEmptyHistoryState(), 400);
    await update(editor, () =>
      $buildList([
        { text: 'before' },
        { text: 'parent' },
        { text: 'child', indent: 1 },
        { text: 'grandchild', indent: 2 },
        { text: 'after' },
      ])
    );

    await swipe(editor, 'parent', 50);
    expect(readIndents(editor)).toEqual([0, 1, 2, 3, 0]);
    editor.dispatchCommand(UNDO_COMMAND, undefined);
    await Promise.resolve();
    expect(readIndents(editor)).toEqual([0, 0, 1, 2, 0]);
    editor.dispatchCommand(REDO_COMMAND, undefined);
    await Promise.resolve();
    expect(readIndents(editor)).toEqual([0, 1, 2, 3, 0]);
  });

  it.each(['bullet', 'number', 'check'] as const)(
    'moves descendants with their parent in a %s list',
    async (listType) => {
      const editor = createTestEditor();
      registerList(editor);
      const items = [
        { text: 'before' },
        { text: 'existing child', indent: 1 },
        { text: 'parent' },
        { text: 'child', indent: 1 },
        { text: 'grandchild', indent: 2 },
        { text: 'another child', indent: 1 },
        { text: 'after' },
        { text: 'unrelated child', indent: 1 },
      ];
      let selectedKey = '';
      await update(editor, () => {
        $buildList(items, listType);
        const grandchild = $getRoot().getAllTextNodes()[4];
        selectedKey = grandchild.getKey();
        grandchild.select(2, 5);
        if (listType === 'check') {
          const child = $getRoot().getAllTextNodes()[3].getParent();
          if ($isListItemNode(child)) child.setChecked(true);
        }
      });
      expect(readIndents(editor)).toEqual([0, 1, 0, 1, 2, 1, 0, 1]);

      await swipe(editor, 'parent', 50);
      expect(readIndents(editor)).toEqual([0, 1, 1, 2, 3, 2, 0, 1]);
      editor.read(() => {
        expect($getSelection()).toMatchObject({
          anchor: { key: selectedKey, offset: 2 },
          focus: { key: selectedKey, offset: 5 },
        });
      });

      await swipe(editor, 'parent', -50);
      expect(readIndents(editor)).toEqual([0, 1, 0, 1, 2, 1, 0, 1]);
      editor.read(() => {
        const textNodes = $getRoot().getAllTextNodes();
        expect(textNodes.map((node) => node.getTextContent())).toEqual(
          items.map((item) => item.text)
        );
        for (const node of textNodes) {
          const list = node.getParentOrThrow().getParent();
          expect($isListNode(list) && list.getListType()).toBe(listType);
        }
        expect($getSelection()).toMatchObject({
          anchor: { key: selectedKey, offset: 2 },
          focus: { key: selectedKey, offset: 5 },
        });
        if (listType === 'check') {
          const child = textNodes[3].getParent();
          expect($isListItemNode(child) && child.getChecked()).toBe(true);
        }
      });
    }
  );

  it.each(['first', 'middle', 'last'] as const)(
    'outdents a %s sibling with its descendants',
    async (position) => {
      const editor = createTestEditor();
      registerList(editor);
      const preceding =
        position === 'first' ? [] : [{ text: 'before', indent: 1 }];
      const following =
        position === 'last' ? [] : [{ text: 'after', indent: 1 }];
      await update(editor, () =>
        $buildList([
          { text: 'root' },
          ...preceding,
          { text: 'parent', indent: 1 },
          { text: 'child', indent: 2 },
          { text: 'grandchild', indent: 3 },
          ...following,
          { text: 'next root' },
        ])
      );

      await swipe(editor, 'parent', -50);
      expect(readIndents(editor)).toEqual([
        0,
        ...preceding.map(() => 1),
        0,
        1,
        2,
        ...following.map(() => 1),
        0,
      ]);
      editor.read(() => {
        expect(
          $getRoot()
            .getAllTextNodes()
            .map((node) => node.getTextContent())
        ).toEqual([
          'root',
          ...preceding.map((item) => item.text),
          'parent',
          'child',
          'grandchild',
          ...following.map((item) => item.text),
          'next root',
        ]);
      });
    }
  );

  it.each(['bullet', 'number', 'check'] as const)(
    'indents and outdents the first %s item with its descendants',
    async (listType) => {
      const editor = createTestEditor();
      registerList(editor);
      await update(editor, () =>
        $buildList(
          [
            { text: 'parent' },
            { text: 'child', indent: 1 },
            { text: 'grandchild', indent: 2 },
            { text: 'after' },
          ],
          listType
        )
      );
      const before = editor.getEditorState().toJSON();

      await swipe(editor, 'parent', -50);
      expect(editor.getEditorState().toJSON()).toEqual(before);
      await swipe(editor, 'parent', 50);
      expect(readIndents(editor)).toEqual([1, 2, 3, 0]);
      await swipe(editor, 'parent', 50);
      expect(readIndents(editor)).toEqual([2, 3, 4, 0]);
      await swipe(editor, 'parent', -50);
      expect(readIndents(editor)).toEqual([1, 2, 3, 0]);
      await swipe(editor, 'parent', -50);
      expect(editor.getEditorState().toJSON()).toEqual(before);
    }
  );

  it('indents and outdents after list transforms run', async () => {
    const editor = createTestEditor();
    registerList(editor);
    await update(editor, () => {
      $buildList([{ text: 'one' }, { text: 'two' }]);
    });

    await swipe(editor, 'two', 50);
    expect(readIndents(editor)).toEqual([0, 1]);

    await swipe(editor, 'two', -50);
    expect(readIndents(editor)).toEqual([0, 0]);
  });
});
