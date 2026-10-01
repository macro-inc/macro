import {
  createGraphicsEditor,
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
