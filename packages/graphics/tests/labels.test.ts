import { afterEach, expect, it, vi } from 'vitest';
import {
  canLabel,
  copyFragment,
  createGraphicsEditor,
  createScene,
  freezeDocument,
  type LabelShape,
  multiply,
  parseFragment,
  pasteCommand,
  plainRichText,
  rectangleDefinition,
  rotation,
  type ShapeLabel,
  setShapeLabelCommand,
  shapeLabelLayout,
  shapeLabelText,
  textTargetAt,
  transformPoint,
  translation,
  worldMatrix,
} from '../src/core';
import { createGraphicsPeerLab } from '../src/loro';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));
const label = (text = 'Shape label'): ShapeLabel => ({
  content: plainRichText(text),
  fontSize: 20,
  fontFamily: 'sans',
  height: 27,
});
const shape = (type: LabelShape['type'] = 'rectangle'): LabelShape => ({
  id: 'shape',
  type,
  placement: { parentId: 'scene-root', sortKey: 'a0' },
  transform: translation(30, 40),
  geometry: { width: 200, height: 100 },
  appearance: { fill: 'transparent', stroke: 'black' },
});
it('commits a frozen shape-owned label, copies it, and clears just the label with undo', () => {
  const editor = createGraphicsEditor([shape()]);
  cleanups.push(editor.dispose);
  editor.execute(setShapeLabelCommand, { id: 'shape', label: label(' ') });
  expect(editor.getSession().canUndo).toBe(false);
  editor.execute(setShapeLabelCommand, { id: 'shape', label: label() });
  const item = editor.document.items.shape;
  if (!canLabel(item)) throw Error();
  expect(Object.isFrozen(item.geometry.label!)).toBe(true);
  const fragment = parseFragment(
    JSON.stringify(copyFragment(editor.document, ['shape']))
  )!;
  editor.execute(pasteCommand, { fragment, createId: () => 'copy' });
  expect(editor.document.items.copy).toMatchObject({
    geometry: { label: label() },
  });
  editor.execute(setShapeLabelCommand, { id: 'shape', label: label('') });
  expect(editor.document.items.shape).toEqual(shape());
  expect(editor.getSession().selectedId).toBe('shape');
  editor.undo();
  expect(editor.document.items.shape).toEqual(item);
});
it('reflows labels on side resize while retaining typography and shape dimensions', () => {
  const item = {
    ...shape(),
    geometry: { ...shape().geometry, label: label() },
  };
  const measure = vi.fn((g) => ({ width: g.width, height: 81 }));
  const editor = createGraphicsEditor([item], { measureText: measure });
  cleanups.push(editor.dispose);
  editor.select('shape');
  editor.beginTransform('shape', { x: 230, y: 90 }, 'e');
  editor.updateTransform({ x: 130, y: 90 });
  editor.commitTransform();
  expect(editor.document.items.shape).toMatchObject({
    geometry: {
      width: 100,
      height: 100,
      label: { fontSize: 20, height: 81, content: label().content },
    },
  });
  expect(measure).toHaveBeenCalledWith(
    expect.objectContaining({ width: 76, autoWidth: false })
  );
  editor.undo();
  expect(editor.document.items.shape).toEqual(item);
});
it.each(['rectangle', 'ellipse'] as const)(
  'centers and uniformly fits %s labels through nested transforms',
  (type) => {
    const item = {
      ...shape(type),
      placement: { parentId: 'group', sortKey: 'a0' },
      transform: rotation(0.4),
      geometry: { width: 80, height: 40, label: label() },
    };
    const scene = createScene([
      {
        id: 'group',
        type: 'group',
        placement: { parentId: 'scene-root', sortKey: 'a0' },
        transform: multiply(translation(300, 150), rotation(-0.8)),
      },
      item,
    ]);
    const layout = shapeLabelLayout(item)!,
      projected = shapeLabelText(item)!;
    expect(layout.transform[0]).toBe(layout.transform[3]);
    expect(layout.transform[0]).toBeLessThan(1);
    const center = {
      x: layout.geometry.width / 2,
      y: layout.geometry.height / 2,
    };
    const projectedWorld = multiply(
      worldMatrix(scene, 'group'),
      projected.transform
    );
    const actual = transformPoint(projectedWorld, center),
      expected = transformPoint(worldMatrix(scene, 'shape'), { x: 40, y: 20 });
    expect(actual.x).toBeCloseTo(expected.x);
    expect(actual.y).toBeCloseTo(expected.y);
  }
);
it('keeps ordinary click-through while text gestures enter unfilled shapes and painted labels select their owner', () => {
  const editor = createGraphicsEditor([shape()]);
  cleanups.push(editor.dispose);
  const center = { x: 130, y: 90 };
  expect(editor.hitTest(center)).toBeUndefined();
  expect(textTargetAt(editor.document, center)).toBe('shape');
  editor.execute(setShapeLabelCommand, { id: 'shape', label: label() });
  expect(editor.hitTest(center)).toBe('shape');
  expect(editor.hitTest({ x: 40, y: 50 })).toBeUndefined();
  const ellipse = createScene([shape('ellipse')]);
  expect(textTargetAt(ellipse, { x: 31, y: 41 })).toBeUndefined();
  expect(textTargetAt(ellipse, center)).toBe('shape');
});
it('rejects invalid and unsafe label data at the document boundary', () => {
  const item = shape();
  for (const invalid of [
    { ...label(), height: NaN },
    { ...label(), fontSize: -1 },
    { ...label(), content: plainRichText('x'.repeat(100001)) },
  ]) {
    expect(
      rectangleDefinition.validateGeometry({ ...item.geometry, label: invalid })
    ).toBe(false);
    expect(() =>
      freezeDocument(
        createScene([
          { ...item, geometry: { ...item.geometry, label: invalid } },
        ])
      )
    ).toThrow();
  }
});
it('round trips labels through the existing Loro geometry adapter and local undo', () => {
  const lab = createGraphicsPeerLab(createScene([shape()]));
  cleanups.push(lab.dispose);
  lab.setConnected(false);
  const a = lab.peers[0]!.editor,
    b = lab.peers[1]!.editor;
  const before = a.document.items.shape;
  a.execute(setShapeLabelCommand, { id: 'shape', label: label() });
  lab.syncNow();
  expect(b.document).toEqual(a.document);
  expect(b.document.items.shape).toMatchObject({
    geometry: { label: label() },
  });
  a.undo();
  lab.syncNow();
  expect(b.document.items.shape).toEqual(before);
});
