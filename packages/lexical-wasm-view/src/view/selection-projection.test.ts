/** @vitest-environment jsdom */
import {
  $createNodeSelection,
  $createParagraphNode,
  $createTextNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isNodeSelection,
  $isTextNode,
  $setSelection,
  createEditor,
} from 'lexical';
import { beforeAll, expect, test } from 'vitest';
import { registerExternalEditorRoot } from './editor-roots';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from './test/native-surface';

beforeAll(initializeNativeSurfaceTests);

function source() {
  const editor = createEditor({
    onError(error) {
      throw error;
    },
  });
  let releaseRoot: (() => void) | undefined;
  const releaseListener = editor.registerRootListener((root) => {
    releaseRoot?.();
    releaseRoot = root ? registerExternalEditorRoot(root, editor) : undefined;
  });
  const root = document.createElement('div');
  root.contentEditable = 'true';
  document.body.appendChild(root);
  editor.setRootElement(root);
  let key = '';
  editor.update(
    () => {
      const text = $createTextNode('selection');
      key = text.getKey();
      $getRoot().append($createParagraphNode().append(text));
    },
    { discrete: true }
  );
  return {
    root,
    editable(value: boolean) {
      editor.setEditable(value);
    },
    detach() {
      editor.setRootElement(null);
    },
    range() {
      root.focus();
      editor.update(
        () => {
          const text = $getNodeByKey(key);
          if (!$isTextNode(text)) throw new Error('Missing source text');
          text.select(1, 1);
        },
        { discrete: true }
      );
    },
    node() {
      editor.update(
        () => {
          const selection = $createNodeSelection();
          selection.add(key);
          $setSelection(selection);
        },
        { discrete: true }
      );
    },
    hasNodeSelection() {
      return editor
        .getEditorState()
        .read(() => $isNodeSelection($getSelection()));
    },
    close() {
      editor.setRootElement(null);
      releaseListener();
      releaseRoot?.();
      root.remove();
    },
  };
}
function native() {
  const fixture = nativeSurface();
  fixture.port.setState(
    JSON.stringify({
      root: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [{ type: 'text', text: 'selection' }],
          },
        ],
      },
    })
  );
  const paragraph = fixture.view.node(0)?.children[0];
  const key =
    paragraph === undefined
      ? undefined
      : fixture.view.node(paragraph)?.children[0];
  if (key === undefined) throw new Error('Missing native text');
  return {
    root: fixture.root,
    editable(value: boolean) {
      fixture.view.setEditable(value);
    },
    range() {
      fixture.root.focus();
      fixture.port.selectionFromView({
        kind: 'range',
        anchor: { key, type: 'text', offset: 1 },
        focus: { key, type: 'text', offset: 1 },
      });
    },
    node() {
      fixture.port.selectionFromView({ kind: 'node', keys: [key] });
    },
    hasNodeSelection() {
      return fixture.view.selection().selection.kind === 'node';
    },
    close: fixture.close,
  };
}

for (const [name, create] of [
  ['source', source],
  ['native', native],
] as const) {
  test(`${name} updates a readonly node-selection cache without changing the DOM range`, () => {
    const fixture = create();
    try {
      fixture.range();
      const selection = document.getSelection();
      const anchor = selection?.anchorNode;
      const offset = selection?.anchorOffset;
      fixture.editable(false);
      fixture.node();
      expect(fixture.hasNodeSelection()).toBe(true);
      expect(selection?.rangeCount).toBe(1);
      expect(selection?.anchorNode).toBe(anchor);
      expect(selection?.anchorOffset).toBe(offset);
    } finally {
      fixture.close();
    }
  });
  test(`${name} preserves a DOM range owned by a nested editor`, () => {
    const outer = create();
    const inner = create();
    try {
      outer.range();
      outer.root.appendChild(inner.root);
      inner.range();
      const selection = document.getSelection();
      expect(inner.root.contains(selection?.anchorNode ?? null)).toBe(true);
      outer.node();
      expect(outer.hasNodeSelection()).toBe(true);
      expect(inner.root.contains(selection?.anchorNode ?? null)).toBe(true);
      expect(selection?.rangeCount).toBe(1);
    } finally {
      inner.close();
      outer.close();
    }
  });
  test(`${name} clears an owned DOM range when a range becomes a node selection`, () => {
    const fixture = create();
    try {
      fixture.range();
      expect(document.getSelection()?.rangeCount).toBe(1);
      fixture.node();
      expect(fixture.hasNodeSelection()).toBe(true);
      expect(document.getSelection()?.rangeCount).toBe(0);
    } finally {
      fixture.close();
    }
  });
  test(`${name} preserves a foreign DOM range when a range becomes a node selection`, () => {
    const fixture = create();
    const other = document.createElement('p');
    other.textContent = 'outside';
    document.body.appendChild(other);
    try {
      fixture.range();
      document.getSelection()?.setBaseAndExtent(other, 0, other, 1);
      fixture.node();
      expect(fixture.hasNodeSelection()).toBe(true);
      expect(document.getSelection()?.anchorNode).toBe(other);
      expect(document.getSelection()?.rangeCount).toBe(1);
    } finally {
      fixture.close();
      other.remove();
    }
  });
  test(`${name} preserves an initial DOM range when the previous model selection is null`, () => {
    const fixture = create();
    try {
      fixture.root.focus();
      document
        .getSelection()
        ?.setBaseAndExtent(fixture.root, 0, fixture.root, 0);
      fixture.node();
      expect(fixture.hasNodeSelection()).toBe(true);
      expect(document.getSelection()?.rangeCount).toBe(1);
    } finally {
      fixture.close();
    }
  });
}

test('native preserves a DOM range inside an actual retained source editor', () => {
  const outer = native();
  const inner = source();
  try {
    outer.range();
    outer.root.appendChild(inner.root);
    inner.range();
    const selection = document.getSelection();
    outer.node();
    expect(outer.hasNodeSelection()).toBe(true);
    expect(inner.root.contains(selection?.anchorNode ?? null)).toBe(true);
    expect(selection?.rangeCount).toBe(1);
  } finally {
    inner.close();
    outer.close();
  }
});

for (const [name, create] of [
  ['source', source],
  ['native', native],
] as const) {
  test(`${name} projects through retained DOM after the actual nested source editor unmounts`, () => {
    const outer = create();
    const inner = source();
    try {
      outer.range();
      outer.root.appendChild(inner.root);
      inner.range();
      inner.detach();
      const text = document.createTextNode('retained DOM');
      inner.root.appendChild(text);
      document.getSelection()?.setBaseAndExtent(text, 1, text, 1);
      outer.node();
      expect(outer.hasNodeSelection()).toBe(true);
      expect(document.getSelection()?.rangeCount).toBe(0);
    } finally {
      inner.close();
      outer.close();
    }
  });
}
