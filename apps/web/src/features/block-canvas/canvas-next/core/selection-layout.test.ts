import {
  createGraphicsEditor,
  multiply,
  rotation,
  type ShapeItem,
  scaling,
  type TextMeasurer,
  translation,
  worldBounds,
  worldMatrix,
} from '@macro-inc/graphics';
import { expect, it } from 'vitest';
import { createCanvasNextScene } from './seed-scene';
import { layoutValue, selectionLayoutCommand } from './selection-layout';

it('edits position, dimensions and rotation with undo', () => {
  const editor = createGraphicsEditor(createCanvasNextScene());
  editor.select('welcome-rectangle');
  editor.execute(selectionLayoutCommand, { field: 'x', value: -30 });
  expect(worldBounds(editor.document, 'welcome-rectangle').x).toBe(-30);
  editor.execute(selectionLayoutCommand, { field: 'width', value: 120 });
  expect(worldBounds(editor.document, 'welcome-rectangle').width).toBeCloseTo(
    120
  );
  editor.execute(selectionLayoutCommand, { field: 'rotation', value: 45 });
  expect(layoutValue(editor.document, ['welcome-rectangle'], 'rotation')).toBe(
    45
  );
  editor.undo();
  expect(layoutValue(editor.document, ['welcome-rectangle'], 'rotation')).toBe(
    0
  );
  editor.dispose();
});
it('sets equal spacing without changing item sizes and preserves the first item', () => {
  const editor = createGraphicsEditor(createCanvasNextScene());
  editor.select('welcome-rectangle');
  editor.toggleSelection('welcome-ellipse');
  editor.toggleSelection('welcome-small');
  const ids = editor.getSession().selectedIds;
  editor.execute(selectionLayoutCommand, { field: 'gapX', value: 20 });
  expect(layoutValue(editor.document, ids, 'gapX')).toBe(20);
  expect(worldBounds(editor.document, 'welcome-rectangle').x).toBe(100);
  expect(worldBounds(editor.document, 'welcome-ellipse').width).toBe(180);
  editor.dispose();
});
it('flips twice without losing the original transform', () => {
  const editor = createGraphicsEditor(createCanvasNextScene());
  editor.select('welcome-rectangle');
  const before = worldMatrix(editor.document, 'welcome-rectangle');
  editor.execute(selectionLayoutCommand, { field: 'flipX' });
  editor.execute(selectionLayoutCommand, { field: 'flipX' });
  expect(worldMatrix(editor.document, 'welcome-rectangle')).toEqual(before);
  editor.dispose();
});

it('preserves each selected item aspect ratio for locked width and height edits', () => {
  const editor = createGraphicsEditor(createCanvasNextScene());
  editor.select('welcome-rectangle');
  editor.toggleSelection('welcome-ellipse');
  const ids = editor.getSession().selectedIds;
  const before = ids.map((id) => worldBounds(editor.document, id));
  for (const field of ['width', 'height'] as const) {
    editor.execute(selectionLayoutCommand, {
      field,
      value: 240,
      lockAspectRatio: true,
    });
    ids.forEach((id, index) => {
      const bounds = worldBounds(editor.document, id);
      expect(bounds[field]).toBeCloseTo(240);
      expect(bounds.width / bounds.height).toBeCloseTo(
        before[index]!.width / before[index]!.height
      );
    });
    editor.undo();
    ids.forEach((id, index) =>
      expect(worldBounds(editor.document, id)).toEqual(before[index])
    );
  }
  editor.execute(selectionLayoutCommand, { field: 'width', value: 240 });
  ids.forEach((id, index) =>
    expect(worldBounds(editor.document, id).height).toBeCloseTo(
      before[index]!.height
    )
  );
  editor.dispose();
});

it('snaps position, size and gaps while preserving explicit angle values', () => {
  const editor = createGraphicsEditor(createCanvasNextScene(), { snapUnit: 8 });
  editor.select('welcome-rectangle');
  editor.execute(selectionLayoutCommand, { field: 'x', value: -13 });
  expect(layoutValue(editor.document, ['welcome-rectangle'], 'x')).toBe(-16);
  editor.execute(selectionLayoutCommand, { field: 'width', value: 1 });
  expect(layoutValue(editor.document, ['welcome-rectangle'], 'width')).toBe(8);
  const before = editor.document;
  editor.execute(selectionLayoutCommand, { field: 'width', value: -1 });
  expect(editor.document).toBe(before);
  editor.execute(selectionLayoutCommand, { field: 'rotation', value: 13.2 });
  expect(layoutValue(editor.document, ['welcome-rectangle'], 'rotation')).toBe(
    13.2
  );
  editor.toggleSelection('welcome-ellipse');
  editor.execute(selectionLayoutCommand, { field: 'gapX', value: 19 });
  expect(
    layoutValue(editor.document, editor.getSession().selectedIds, 'gapX')
  ).toBe(16);
  editor.dispose();
});

const labeledShape = (
  type: 'rectangle' | 'ellipse'
): ShapeItem<'rectangle' | 'ellipse'> => ({
  id: 'shape',
  type,
  placement: { parentId: 'scene-root', sortKey: 'a0' },
  transform: translation(30, 40),
  appearance: { fill: 'transparent', stroke: 'black' },
  geometry: {
    width: 200,
    height: 100,
    label: {
      content: 'A label that wraps',
      fontSize: 20,
      fontFamily: 'sans',
      height: 27,
    },
  },
});
const measureLabel: TextMeasurer = (g) => ({
  width: g.width,
  height: g.width < 120 ? 81 : 27,
});

it.each(['rectangle', 'ellipse'] as const)(
  'matches canvas side resizing for %s labels, including undo',
  (type) => {
    for (const field of ['width', 'height'] as const) {
      const shape = labeledShape(type);
      const panel = createGraphicsEditor([shape], {
        measureText: measureLabel,
      });
      const direct = createGraphicsEditor([shape], {
        measureText: measureLabel,
      });
      panel.select('shape');
      direct.select('shape');
      panel.execute(selectionLayoutCommand, {
        field,
        value: field === 'width' ? 100 : 160,
      });
      direct.beginTransform(
        'shape',
        field === 'width' ? { x: 230, y: 90 } : { x: 130, y: 140 },
        field === 'width' ? 'e' : 's'
      );
      direct.updateTransform(
        field === 'width' ? { x: 130, y: 90 } : { x: 130, y: 200 }
      );
      direct.commitTransform();
      expect(panel.document.items.shape).toEqual(direct.document.items.shape);
      expect(worldMatrix(panel.document, 'shape').slice(0, 4)).toEqual([
        1, 0, 0, 1,
      ]);
      panel.undo();
      expect(panel.document.items.shape).toEqual(shape);
      panel.dispose();
      direct.dispose();
    }
  }
);

it('remeasures labels inside scaled groups without magnifying their typography', () => {
  const shape = labeledShape('rectangle');
  const editor = createGraphicsEditor(
    [
      {
        id: 'group',
        type: 'group',
        placement: { parentId: 'scene-root', sortKey: 'a0' },
        transform: scaling(2, 2),
      },
      { ...shape, placement: { ...shape.placement, parentId: 'group' } },
    ],
    { measureText: measureLabel }
  );
  editor.select('group');
  editor.execute(selectionLayoutCommand, { field: 'width', value: 200 });
  expect(layoutValue(editor.document, ['group'], 'width')).toBe(200);
  expect(editor.document.items.shape).toMatchObject({
    geometry: { width: 100, label: { fontSize: 20, height: 81 } },
  });
  expect(worldMatrix(editor.document, 'shape').slice(0, 4)).toEqual([
    2, 0, 0, 2,
  ]);
  editor.dispose();
});

it('keeps rotated labels unsheared when editing world dimensions', () => {
  const shape = {
    ...labeledShape('rectangle'),
    transform: multiply(translation(30, 40), rotation(Math.PI / 4)),
  };
  const editor = createGraphicsEditor([shape], { measureText: measureLabel });
  editor.select('shape');
  editor.execute(selectionLayoutCommand, { field: 'width', value: 300 });
  expect(layoutValue(editor.document, ['shape'], 'width')).toBeCloseTo(300);
  expect(worldMatrix(editor.document, 'shape').slice(0, 4)).toEqual(
    shape.transform.slice(0, 4)
  );
  editor.dispose();
});

it('matches direct width reflow and proportional height resizing for standalone text', () => {
  const text: ShapeItem<'text'> = {
    id: 'text',
    type: 'text',
    placement: { parentId: 'scene-root', sortKey: 'a0' },
    transform: translation(30, 40),
    appearance: { fill: 'transparent', stroke: 'black' },
    geometry: {
      width: 200,
      height: 27,
      fontSize: 20,
      fontFamily: 'sans',
      autoWidth: true,
      content: 'Wrapping text',
    },
  };
  for (const field of ['width', 'height'] as const) {
    const panel = createGraphicsEditor([text], { measureText: measureLabel });
    const direct = createGraphicsEditor([text], { measureText: measureLabel });
    panel.select('text');
    direct.select('text');
    panel.execute(selectionLayoutCommand, {
      field,
      value: field === 'width' ? 100 : 54,
    });
    direct.beginTransform(
      'text',
      field === 'width' ? { x: 230, y: 53.5 } : { x: 130, y: 67 },
      field === 'width' ? 'e' : 's'
    );
    direct.updateTransform(
      field === 'width' ? { x: 130, y: 53.5 } : { x: 130, y: 94 }
    );
    direct.commitTransform();
    expect(panel.document.items.text).toMatchObject({
      geometry:
        direct.document.items.text?.type === 'text'
          ? direct.document.items.text.geometry
          : undefined,
      // Inspector dimensions retain the top-left anchor; bottom handles keep
      // the horizontal center while proportionally scaling standalone text.
      transform: text.transform,
    });
    panel.dispose();
    direct.dispose();
  }
});
