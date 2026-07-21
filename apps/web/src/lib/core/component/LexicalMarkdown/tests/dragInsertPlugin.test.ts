import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  type LexicalEditor,
  type NodeKey,
} from 'lexical';
import { describe, expect, test } from 'vitest';
import {
  createDragInsertStore,
  dragInsertPlugin,
  type InsertionMarker,
} from '../plugins/drag-insert/dragInsertPlugin';

function stubRect(
  el: Element,
  rect: { top: number; height: number; left?: number; width?: number }
) {
  const { top, height, left = 0, width = 100 } = rect;
  el.getBoundingClientRect = () =>
    ({
      top,
      bottom: top + height,
      height,
      left,
      right: left + width,
      width,
      x: left,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
}

/**
 * Editor with two 20px-tall paragraphs and a 40px gap between them. With the
 * plugin's 8px collision padding, y in (28, 52) resolves to no insert point.
 */
function createTestEditor(): {
  editor: LexicalEditor;
  container: HTMLDivElement;
  keys: NodeKey[];
} {
  const editor = createEditor({
    namespace: 'test-drag-insert',
    onError: (e) => {
      throw e;
    },
  });

  const root = document.createElement('div');
  root.contentEditable = 'true';
  const container = document.createElement('div');
  container.appendChild(root);
  document.body.appendChild(container);
  editor.setRootElement(root);

  editor.update(
    () => {
      $getRoot()
        .clear()
        .append(
          $createParagraphNode().append($createTextNode('first')),
          $createParagraphNode().append($createTextNode('second'))
        );
    },
    { discrete: true }
  );

  const keys = editor.getEditorState().read(() =>
    $getRoot()
      .getChildren()
      .map((child) => child.getKey())
  );

  stubRect(root, { top: 0, height: 100 });
  stubRect(editor.getElementByKey(keys[0])!, { top: 0, height: 20 });
  stubRect(editor.getElementByKey(keys[1])!, { top: 60, height: 20 });

  return { editor, container, keys };
}

function dispatchDragEvent(
  target: HTMLElement,
  type: 'dragover' | 'drop' | 'dragleave' | 'dragend',
  clientX: number,
  clientY: number
) {
  // jsdom has no DragEvent constructor; the handlers only read coordinates.
  target.dispatchEvent(
    new MouseEvent(type, { clientX, clientY, bubbles: true, cancelable: true })
  );
}

describe('dragInsertPlugin', () => {
  test('drop with no valid insert position still hides the indicator', () => {
    const { editor, container, keys } = createTestEditor();
    const [store, setStore] = createDragInsertStore();
    const cleanup = dragInsertPlugin({
      setState: setStore,
      dragListenerRef: container,
    })(editor);

    dispatchDragEvent(container, 'dragover', 50, 15);
    expect(store.visible).toBe(true);
    expect(store.nodeKey).toBe(keys[0]);
    expect(store.position).toBe('after');

    // Drop in the gap between the two blocks. External drags (OS files,
    // images dragged from other components) fire no dragend/dragleave here
    // afterwards, so the drop handler must clear the indicator itself.
    dispatchDragEvent(container, 'drop', 50, 40);
    expect(store.visible).toBe(false);

    cleanup();
  });

  test('drop at a valid position hides the indicator and reports the drop', () => {
    const { editor, container, keys } = createTestEditor();
    const [store, setStore] = createDragInsertStore();
    const drops: Array<[NodeKey, InsertionMarker]> = [];
    const cleanup = dragInsertPlugin({
      setState: setStore,
      dragListenerRef: container,
      onDrop: (key, position) => drops.push([key, position]),
    })(editor);

    dispatchDragEvent(container, 'dragover', 50, 65);
    expect(store.visible).toBe(true);

    dispatchDragEvent(container, 'drop', 50, 75);
    expect(store.visible).toBe(false);
    expect(drops).toEqual([[keys[1], 'after']]);

    cleanup();
  });

  test('dragover outside any insert position hides the indicator', () => {
    const { editor, container } = createTestEditor();
    const [store, setStore] = createDragInsertStore();
    const cleanup = dragInsertPlugin({
      setState: setStore,
      dragListenerRef: container,
    })(editor);

    dispatchDragEvent(container, 'dragover', 50, 15);
    expect(store.visible).toBe(true);

    dispatchDragEvent(container, 'dragover', 50, 40);
    expect(store.visible).toBe(false);

    cleanup();
  });
});
