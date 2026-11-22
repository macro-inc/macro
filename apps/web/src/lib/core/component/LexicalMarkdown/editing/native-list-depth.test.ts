import {
  $createListItemNode,
  $createListNode,
  $isListItemNode,
} from '@lexical/list';
import {
  initializeNativeSurfaceTests,
  nativeSurface,
} from '@macro-inc/lexical-wasm-view/view/test/native-surface';
import type { ViewNode } from '@macro-inc/lexical-wasm-view/view/types';
import {
  $createTextNode,
  $getRoot,
  $isElementNode,
  type LexicalNode,
} from 'lexical';
import { beforeAll, expect, test } from 'vitest';
import { behaviorEditor } from '../behavior-inventory/editor';
import { $collectNestedGroup } from '../plugins/draggable-block/draggableBlockPlugin';
import { nativeDragGroup } from '../plugins/draggable-block/nativeGeometry';
import { nativeListDepth } from './native-list-depth';

beforeAll(initializeNativeSurfaceTests);

test('Source nested-list getter and drag groups match projected topology', () => {
  const { editor } = behaviorEditor();
  editor.update(
    () => {
      const a = $createListItemNode().append($createTextNode('a'));
      const b = $createListItemNode().append($createTextNode('b'));
      const c = $createListItemNode().append($createTextNode('c'));
      const d = $createListItemNode().append($createTextNode('d'));
      const e = $createListItemNode().append($createTextNode('e'));
      const deepWrapper = $createListItemNode().append(
        $createListNode('bullet').append(e)
      );
      const wrapper = $createListItemNode().append(
        $createListNode('bullet').append(c, d, deepWrapper)
      );
      $getRoot().append($createListNode('bullet').append(a, b, wrapper));
    },
    { discrete: true }
  );
  const source = editor.read(() => {
    const paths = new Map<string, string>();
    const nodes: LexicalNode[] = [];
    function visit(node: LexicalNode, path: string) {
      paths.set(node.getKey(), path);
      nodes.push(node);
      if ($isElementNode(node))
        node
          .getChildren()
          .forEach((child, index) => visit(child, `${path}/${index}`));
    }
    visit($getRoot(), 'root');
    const rows = nodes.filter($isListItemNode).map((item) => {
      const parent = item.getParentOrThrow();
      const group = parent.getFirstChild()?.is(item)
        ? [parent]
        : $collectNestedGroup(item);
      return {
        path: paths.get(item.getKey()),
        depth: item.getIndent(),
        group: group.map((node) => paths.get(node.getKey())),
      };
    });
    return { json: editor.getEditorState().toJSON(), rows };
  });
  const fixture = nativeSurface();
  try {
    // Depth/drag characterization only; list-item JSON import uses its virtual setter.
    // Actual Seed/Loro full-LI DOM controls retain the padding gate separately.
    fixture.port.setState(JSON.stringify(source.json));
    const keys = new Map<string, number>();
    const paths = new Map<number, string>();
    function visit(key: number, path: string) {
      const node = fixture.view.node(key);
      if (!node) throw new Error('Missing actual projected node');
      keys.set(path, key);
      paths.set(key, path);
      node.children.forEach((child, index) => visit(child, `${path}/${index}`));
    }
    visit(0, 'root');
    const before = fixture.view.query.serializedState();
    const admissions = fixture.counters.admissions;
    for (const row of source.rows) {
      if (!row.path) throw new Error('Missing Source node path');
      const key = keys.get(row.path);
      if (key === undefined)
        throw new Error('Missing matched native node path');
      expect(nativeListDepth(fixture.view, key)).toBe(row.depth);
      expect(
        nativeDragGroup(fixture.view, key).map((key) => paths.get(key))
      ).toEqual(row.group);
    }
    expect(source.rows.map((row) => row.depth)).toEqual([0, 0, 0, 1, 1, 1, 2]);
    expect(fixture.view.query.serializedState()).toBe(before);
    expect(fixture.counters.admissions).toBe(admissions);
    expect(fixture.errors).toEqual([]);
  } finally {
    fixture.close();
  }
});

test.each([
  { kind: 'paragraph', indent: 0, empty: true },
  { kind: 'paragraph', indent: 1, empty: false },
  { kind: 'list', indent: 0, empty: false },
] as const)(
  'Mirror blank-paragraph classification stays unchanged for $kind/raw$indent',
  ({ kind, indent, empty }) => {
    const fixture = nativeSurface();
    try {
      const child =
        kind === 'paragraph'
          ? { type: 'paragraph', version: 1, indent, children: [] }
          : {
              type: 'list',
              version: 1,
              listType: 'bullet',
              tag: 'ul',
              start: 1,
              indent: 0,
              children: [
                {
                  type: 'listitem',
                  version: 1,
                  indent: 0,
                  value: 1,
                  children: [],
                },
              ],
            };
      fixture.port.setState(
        JSON.stringify({
          root: { type: 'root', version: 1, children: [child] },
        })
      );
      expect(fixture.view.isEmpty()).toBe(empty);
      expect(fixture.errors).toEqual([]);
    } finally {
      fixture.close();
    }
  }
);

// Synthetic graph fixtures pin only the pure helper contract. They do not
// substitute for the actual Source/native-session topology and drag case above.
function item(key: number, parent: number | null, rawIndent: number): ViewNode {
  return {
    key,
    parent,
    type: 'listitem',
    typeIndex: 1,
    kind: 'element',
    children: [],
    text: '',
    propsJSON: '{}',
    stateJSON: '{}',
    elementProps: {
      format: 0,
      indent: rawIndent,
      direction: 0,
      textFormat: 0,
      style: '',
      textStyle: '',
    },
    props() {
      return {};
    },
  };
}

test('detached list item uses its raw indent', () => {
  const detached = item(7, null, 3);
  expect(
    nativeListDepth({ node: (key) => (key === 7 ? detached : null) }, 7)
  ).toBe(3);
});

test('missing list item or ancestor refuses', () => {
  const orphan = item(7, 9, 3);
  const view = { node: (key: number) => (key === 7 ? orphan : null) };
  expect(nativeListDepth(view, 8)).toBeNull();
  expect(nativeListDepth(view, 7)).toBeNull();
});

test('self-cycle and ancestor cycle refuse', () => {
  const self = item(7, 7, 3);
  expect(
    nativeListDepth({ node: (key) => (key === 7 ? self : null) }, 7)
  ).toBeNull();
  const first = item(7, 9, 3);
  const second = item(9, 7, 2);
  const nodes = new Map([
    [7, first],
    [9, second],
  ]);
  expect(
    nativeListDepth({ node: (key) => nodes.get(key) ?? null }, 7)
  ).toBeNull();
});
