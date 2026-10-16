import { expect, it } from 'vitest';
import {
  children,
  createGraphicsEditor,
  createScene,
  drawableIds,
  freezeDocument,
  type GraphicsDocument,
  groupNodes,
  hitTest,
  isSortKey,
  type LayerOperation,
  reorderNodes,
  reparent,
  sortKeysBetween,
  ungroupNode,
  worldMatrix,
} from '../src/core';
import { translation } from '../src/core/affine';

const scene = () =>
  createScene(
    ['a', 'b', 'c', 'd', 'e'].map((id, index) => ({
      id,
      type: 'rectangle' as const,
      placement: { parentId: 'scene-root', sortKey: `a${index}` },
      transform: translation(0, 0),
      geometry: { width: 100, height: 100 },
      appearance: { fill: 'red', stroke: 'black' },
    }))
  );
const key = (doc: GraphicsDocument, id: string) => {
  const node = doc.items[id];
  if (!node || node.type === 'surface') throw new Error('Missing spatial node');
  return node.placement.sortKey;
};

it('supports repeated insertion without numeric precision loss or changing neighbors', () => {
  const [first, last] = sortKeysBetween(null, null, 2);
  let upper = last!;
  for (let i = 0; i < 600; i++) {
    const next = sortKeysBetween(first!, upper, 1)[0]!;
    expect(first! < next && next < upper).toBe(true);
    expect(isSortKey(next)).toBe(true);
    upper = next;
  }
  expect(sortKeysBetween(null, first!, 1)[0]! < first!).toBe(true);
  expect(sortKeysBetween(last!, null, 1)[0]! > last!).toBe(true);
  expect(() => sortKeysBetween(last!, first!, 1)).toThrow();
});

it.each([
  ['front', ['a', 'c', 'e', 'b', 'd']],
  ['back', ['b', 'd', 'a', 'c', 'e']],
  ['forward', ['a', 'c', 'b', 'e', 'd']],
  ['backward', ['b', 'a', 'd', 'c', 'e']],
] satisfies [
  LayerOperation,
  string[],
][])('moves a disjoint selection %s without renumbering other nodes', (operation, expected) => {
  const before = scene();
  const after = reorderNodes(before, ['d', 'b'], operation);
  expect(children(after)).toEqual(expected);
  for (const id of ['a', 'c', 'e'])
    expect(key(after, id)).toBe(key(before, id));
  for (const id of children(before))
    expect(worldMatrix(after, id)).toEqual(worldMatrix(before, id));
  expect(hitTest(after, { x: 50, y: 50 })).toBe(expected.at(-1));
});

it('moves contiguous selections one sibling and leaves boundary no-ops out of undo', () => {
  const before = scene();
  expect(children(reorderNodes(before, ['b', 'c', 'e'], 'forward'))).toEqual([
    'a',
    'd',
    'b',
    'c',
    'e',
  ]);
  const editor = createGraphicsEditor(before);
  const unchanged = editor.document;
  editor.select('e');
  editor.reorderSelection('front');
  expect(editor.document).toBe(unchanged);
  expect(editor.getSession().canUndo).toBe(false);
  editor.select('b');
  editor.toggleSelection('c');
  const original = editor.document;
  editor.reorderSelection('front');
  const reordered = editor.document;
  expect(children(reordered)).toEqual(['a', 'd', 'e', 'b', 'c']);
  editor.undo();
  expect(editor.document).toEqual(original);
  expect(editor.getSession().selectedIds).toEqual(['b', 'c']);
  expect(editor.getSession().canUndo).toBe(false);
  editor.redo();
  expect(editor.document).toEqual(reordered);
});

it('keeps groups contiguous and preserves unrelated keys across group, reparent and ungroup', () => {
  const before = scene();
  const grouped = groupNodes(before, ['d', 'b'], 'g');
  expect(children(grouped)).toEqual(['a', 'g', 'c', 'e']);
  expect(children(grouped, 'g')).toEqual(['b', 'd']);
  expect(key(grouped, 'g')).toBe(key(before, 'b'));
  const moved = reorderNodes(grouped, ['g', 'b'], 'front');
  expect(drawableIds(moved)).toEqual(['a', 'c', 'e', 'b', 'd']);
  expect(key(moved, 'b')).toBe(key(before, 'b'));
  const nested = reparent(moved, 'a', 'g', { before: 'd' });
  expect(children(nested, 'g')).toEqual(['b', 'a', 'd']);
  expect(worldMatrix(nested, 'a')).toEqual(worldMatrix(before, 'a'));
  const ungrouped = ungroupNode(nested, 'g');
  expect(children(ungrouped)).toEqual(['c', 'e', 'b', 'a', 'd']);
  for (const id of ['c', 'e']) expect(key(ungrouped, id)).toBe(key(before, id));
  expect(() =>
    reparent(before, 'a', before.rootId, { before: 'missing' })
  ).toThrow();
});

it('reorders independently across parents without flattening the scene', () => {
  const grouped = groupNodes(scene(), ['a', 'b', 'c'], 'g');
  const next = reorderNodes(grouped, ['a', 'd'], 'front');
  expect(children(next, 'g')).toEqual(['b', 'c', 'a']);
  expect(children(next)).toEqual(['g', 'e', 'd']);
  expect(key(next, 'g')).toBe(key(grouped, 'g'));
});

it('creates new shapes above existing content after reorder and deletion', () => {
  const editor = createGraphicsEditor(scene());
  editor.select('a');
  editor.reorderSelection('front');
  editor.select('c');
  editor.deleteSelection();
  const previousKeys = children(editor.document).map(
    (id) => [id, key(editor.document, id)] as const
  );
  editor.beginRectangle({ x: 0, y: 0 });
  editor.updateRectangle({ x: 100, y: 100 });
  editor.commitRectangle('new', { fill: 'blue', stroke: 'black' });
  expect(children(editor.document).at(-1)).toBe('new');
  for (const [id, value] of previousKeys)
    expect(key(editor.document, id)).toBe(value);
});

it('rejects malformed and duplicate sibling sort keys at document boundaries', () => {
  const doc = scene();
  const node = doc.items.b;
  if (!node || node.type === 'surface') throw new Error('fixture');
  for (const sortKey of ['', 'a', 'a!', 'a00', key(doc, 'a')]) {
    const invalid = {
      ...doc,
      items: {
        ...doc.items,
        b: { ...node, placement: { ...node.placement, sortKey } },
      },
    };
    expect(() => freezeDocument(invalid)).toThrow();
  }
});
