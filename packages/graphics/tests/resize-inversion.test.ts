import { expect, it } from 'vitest';
import {
  around,
  createGraphicsEditor,
  createScene,
  freezeDocument,
  inverse,
  multiply,
  nodeCorners,
  type Point,
  rotation,
  scaling,
  selectionFrame,
  transformPoint,
  translation,
} from '../src/core';

const fixture = (layout: string) =>
  createScene([
    ...(layout === 'group' || layout === 'nested'
      ? [
          {
            id: 'g',
            type: 'group' as const,
            placement: { parentId: 'scene-root', sortKey: 'a0' },
            transform: rotation(layout === 'nested' ? 0.4 : 0),
          },
        ]
      : []),
    ...['a', 'b'].map((id, i) => ({
      id,
      type: 'rectangle' as const,
      placement: {
        parentId:
          layout === 'group' || layout === 'nested' ? 'g' : 'scene-root',
        sortKey: `a${i}`,
      },
      transform: translation(20 + i * 200, 30 + i * 120),
      geometry: { width: 100, height: 80 },
      appearance: { fill: 'red', stroke: 'black' },
    })),
  ]);
const closePoint = (a: Point, b: Point) => {
  expect(a.x).toBeCloseTo(b.x, 7);
  expect(a.y).toBeCloseTo(b.y, 7);
};

it.each(['single', 'multi', 'group', 'nested'])(
  'resizes %s through zero, reflects its contents and undoes in one step',
  (layout) => {
    for (const handle of ['n', 'e', 's', 'w'] as const) {
      const editor = createGraphicsEditor(fixture(layout));
      const ids =
        layout === 'single' ? ['a'] : layout === 'multi' ? ['a', 'b'] : ['g'];
      editor.select(ids[0]);
      if (ids.length === 2) editor.toggleSelection('b');
      const before = editor.document;
      const frame = selectionFrame(before, ids)!;
      const b = frame.bounds;
      const horizontal = handle === 'e' || handle === 'w';
      const negative = handle === 'n' || handle === 'w';
      const start = {
        x: horizontal ? b.x + (negative ? 0 : b.width) : b.x + b.width / 2,
        y: horizontal ? b.y + b.height / 2 : b.y + (negative ? 0 : b.height),
      };
      const anchor = {
        x: horizontal ? b.x + (negative ? b.width : 0) : start.x,
        y: horizontal ? start.y : b.y + (negative ? b.height : 0),
      };
      const end = {
        x: start.x + (horizontal ? (negative ? 1 : -1) * b.width * 1.5 : 0),
        y: start.y + (horizontal ? 0 : (negative ? 1 : -1) * b.height * 1.5),
      };
      editor.beginTransform(
        ids[0]!,
        transformPoint(frame.transform, start),
        handle
      );
      // The exact crossing remains finite and can be validated as scene data.
      editor.updateTransform(transformPoint(frame.transform, anchor));
      expect(() =>
        freezeDocument({
          ...before,
          items: { ...before.items, ...editor.getSession().transform!.nodes },
        })
      ).not.toThrow();
      editor.updateTransform(transformPoint(frame.transform, end));
      const nodes = editor.getSession().transform!.nodes;
      const inactive = frame.canDeform ? 1 : 0.5;
      const delta = multiply(
        frame.transform,
        multiply(
          around(
            anchor,
            scaling(horizontal ? -0.5 : inactive, horizontal ? inactive : -0.5)
          ),
          inverse(frame.transform)
        )
      );
      for (const id of layout === 'single' ? ['a'] : ['a', 'b']) {
        const original = nodeCorners(before, id);
        nodeCorners(before, id, nodes).forEach((point, i) =>
          closePoint(point, transformPoint(delta, original[i]!))
        );
      }
      expect(editor.document).toBe(before);
      editor.updateTransform(transformPoint(frame.transform, start));
      nodeCorners(before, 'a', editor.getSession().transform!.nodes).forEach(
        (point, i) => closePoint(point, nodeCorners(before, 'a')[i]!)
      );
      editor.updateTransform(transformPoint(frame.transform, end));
      editor.commitTransform();
      const after = editor.document;
      editor.undo();
      expect(editor.document).toEqual(before);
      expect(editor.getSession().canUndo).toBe(false);
      editor.redo();
      expect(editor.document).toEqual(after);
      editor.dispose();
    }
  }
);

it.each(['single', 'multi', 'group'])(
  'keeps centered proportional corner flips stable for %s when modifiers change',
  (layout) => {
    const editor = createGraphicsEditor(fixture(layout));
    const ids =
      layout === 'single' ? ['a'] : layout === 'multi' ? ['a', 'b'] : ['g'];
    editor.select(ids[0]);
    if (ids.length === 2) editor.toggleSelection('b');
    const before = editor.document;
    const frame = selectionFrame(before, ids)!;
    const b = frame.bounds;
    const start = frame.corners[2]!;
    editor.beginTransform(ids[0]!, start, 'se');
    const end = { x: start.x - b.width, y: start.y - b.height * 0.8 };
    editor.updateTransform(end, { proportional: true, fromCenter: true });
    const delta = around(frame.center, scaling(-1, -1));
    nodeCorners(before, 'a', editor.getSession().transform!.nodes).forEach(
      (point, i) =>
        closePoint(point, transformPoint(delta, nodeCorners(before, 'a')[i]!))
    );
    editor.updateTransform(end, { fromCenter: true });
    editor.updateTransform(end, { proportional: true, fromCenter: true });
    nodeCorners(before, 'a', editor.getSession().transform!.nodes).forEach(
      (point, i) =>
        closePoint(point, transformPoint(delta, nodeCorners(before, 'a')[i]!))
    );
    editor.cancelTransform();
    expect(editor.document).toBe(before);
    expect(editor.getSession().canUndo).toBe(false);
    editor.dispose();
  }
);
