import { describe, expect, it } from 'vitest';
import {
  createGraphicsEditor,
  IDENTITY,
  rotation,
  sortKeysBetween,
  translation,
  worldBounds,
} from '../src/core';
import { createObjectSnapper } from '../src/core/object-snapping';

const moving = {
  id: 'moving',
  type: 'rectangle' as const,
  placement: { parentId: 'scene-root', sortKey: 'a0' },
  transform: IDENTITY,
  geometry: { width: 100, height: 100 },
  appearance: { fill: 'transparent', stroke: 'black' },
};
const target = {
  ...moving,
  id: 'target',
  placement: { parentId: 'scene-root', sortKey: 'a1' },
  transform: translation(300, 0),
};

describe('object snapping', () => {
  it('aligns edges, emits guides, and commits one undoable edit', () => {
    const editor = createGraphicsEditor([moving, target], {
      objectSnapping: true,
    });
    editor.beginTransform('moving', { x: 50, y: 50 });
    editor.updateTransform({ x: 248, y: 50 });
    expect(editor.getSession().transform?.geometry.x).toBe(200);
    expect(editor.getSession().transform?.snapGuides).toContainEqual({
      axis: 'x',
      value: 300,
      start: -8,
      end: 108,
    });
    expect(worldBounds(editor.document, 'moving').x).toBe(0);
    editor.commitTransform();
    expect(editor.getSession().transform).toBeUndefined();
    expect(worldBounds(editor.document, 'moving').x).toBe(200);
    editor.undo();
    expect(worldBounds(editor.document, 'moving').x).toBe(0);
    expect(editor.getSession().canUndo).toBe(false);
  });

  it('aligns centers and preserves off-center pointer grabs', () => {
    const editor = createGraphicsEditor(
      [moving, { ...target, geometry: { width: 200, height: 100 } }],
      { objectSnapping: true }
    );
    editor.beginTransform('moving', { x: 17, y: 21 });
    editor.updateTransform({ x: 365, y: 21 });
    expect(editor.getSession().transform?.geometry.x).toBe(350);
    expect(
      editor
        .getSession()
        .transform?.snapGuides.some((g) => g.axis === 'x' && g.value === 400)
    ).toBe(true);
  });

  it('uses screen-pixel tolerance and ignores distant parallel alignments', () => {
    const editor = createGraphicsEditor([moving, target], {
      objectSnapping: true,
    });
    editor.zoomAt({ x: 0, y: 0 }, 2);
    editor.beginTransform('moving', { x: 0, y: 0 });
    editor.updateTransform({ x: 196, y: 0 });
    expect(editor.getSession().transform?.geometry.x).toBe(196);
    editor.updateTransform({ x: 198, y: 0 });
    expect(editor.getSession().transform?.geometry.x).toBe(200);
    editor.updateTransform({ x: 198, y: 1000 });
    expect(editor.getSession().transform?.geometry.x).toBe(198);
  });

  it('does not snap to itself or violate a constrained axis; objects win over grid', () => {
    const solo = createGraphicsEditor([moving], { objectSnapping: true });
    solo.beginTransform('moving', { x: 0, y: 0 });
    solo.updateTransform({ x: 3, y: 4 });
    expect(solo.getSession().transform?.geometry).toEqual({
      x: 3,
      y: 4,
      width: 100,
      height: 100,
    });
    expect(solo.getSession().transform?.snapGuides).toEqual([]);
    const editor = createGraphicsEditor(
      [moving, { ...target, transform: translation(300, 3) }],
      { objectSnapping: true, snapUnit: 16 }
    );
    editor.beginTransform('moving', { x: 0, y: 0 });
    editor.updateTransform({ x: 201, y: 2 }, { constrainAxis: true });
    expect(editor.getSession().transform?.geometry).toEqual({
      x: 200,
      y: 0,
      width: 100,
      height: 100,
    });
    expect(
      editor.getSession().transform?.snapGuides.every((g) => g.axis === 'x')
    ).toBe(true);
  });

  it('snaps a group as one box and excludes its own descendants', () => {
    const editor = createGraphicsEditor(
      [
        moving,
        { ...target, transform: translation(200, 0) },
        {
          ...target,
          id: 'outside',
          placement: { parentId: 'scene-root', sortKey: 'a2' },
          transform: translation(500, 0),
        },
      ],
      { objectSnapping: true }
    );
    editor.select('moving');
    editor.toggleSelection('target');
    editor.groupSelection('group');
    editor.beginTransform('group', { x: 0, y: 0 });
    editor.updateTransform({ x: 3, y: 0 });
    expect(editor.getSession().transform?.geometry.x).toBe(3);
    editor.updateTransform({ x: 198, y: 0 });
    expect(editor.getSession().transform?.geometry.x).toBe(200);
    editor.commitTransform();
    expect(worldBounds(editor.document, 'moving').x).toBe(200);
    expect(worldBounds(editor.document, 'target').x).toBe(400);
  });

  it('handles transformed target geometry and invalidates the index after edits', () => {
    const editor = createGraphicsEditor(
      [moving, { ...target, transform: [0, 1, -1, 0, 400, 0] }],
      { objectSnapping: true }
    );
    editor.beginTransform('moving', { x: 0, y: 0 });
    editor.updateTransform({ x: 198, y: 0 });
    expect(editor.getSession().transform?.geometry.x).toBe(200);
    editor.cancelTransform();
    editor.select('target');
    editor.deleteSelection();
    editor.beginTransform('moving', { x: 0, y: 0 });
    editor.updateTransform({ x: 198, y: 0 });
    expect(editor.getSession().transform?.geometry.x).toBe(198);
    editor.cancelTransform();
    editor.undo();
    editor.beginTransform('moving', { x: 0, y: 0 });
    editor.updateTransform({ x: 198, y: 0 });
    expect(editor.getSession().transform?.geometry.x).toBe(200);
  });

  it('can be disabled and cancels the pending snap without changing the document', () => {
    const editor = createGraphicsEditor([moving, target], {
      objectSnapping: true,
    });
    editor.beginTransform('moving', { x: 0, y: 0 });
    editor.updateTransform({ x: 198, y: 0 });
    editor.setObjectSnapping(false);
    expect(editor.getSession().transform).toBeUndefined();
    expect(editor.getSession().objectSnapping).toBe(false);
    editor.beginTransform('moving', { x: 0, y: 0 });
    editor.updateTransform({ x: 198, y: 0 });
    expect(editor.getSession().transform?.geometry.x).toBe(198);
  });

  it('resizes a moving edge without translating its stationary edge', () => {
    const editor = createGraphicsEditor([moving, target], {
      objectSnapping: true,
    });
    editor.beginTransform('moving', { x: 102, y: 50 }, 'e');
    editor.updateTransform({ x: 300, y: 50 });
    expect(editor.getSession().transform?.geometry).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 100,
    });
    expect(
      editor.getSession().transform?.snapGuides.some((g) => g.axis === 'x')
    ).toBe(true);
  });

  it('gives object alignment priority over a coarse resize grid', () => {
    const editor = createGraphicsEditor(
      [moving, { ...target, transform: translation(301, 0) }],
      { objectSnapping: true, snapUnit: 16 }
    );
    editor.beginTransform('moving', { x: 100, y: 50 }, 'e');
    editor.updateTransform({ x: 299, y: 50 });
    expect(editor.getSession().transform?.geometry.width).toBe(301);
  });

  it('keeps grid snapping on a resize axis without an object match', () => {
    const editor = createGraphicsEditor(
      [moving, { ...target, transform: translation(301, 0) }],
      { objectSnapping: true, snapUnit: 16 }
    );
    editor.beginTransform('moving', { x: 100, y: 100 }, 'se');
    editor.updateTransform({ x: 299, y: 147 });
    expect(editor.getSession().transform?.geometry.width).toBe(301);
    expect(editor.getSession().transform?.geometry.height).toBeCloseTo(144);
  });

  it('preserves proportional and centered resizing when snapping', () => {
    const editor = createGraphicsEditor([moving, target], {
      objectSnapping: true,
    });
    editor.beginTransform('moving', { x: 100, y: 100 }, 'se');
    editor.updateTransform({ x: 298, y: 250 }, { proportional: true });
    expect(editor.getSession().transform?.geometry).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 300,
    });
    editor.updateTransform(
      { x: 298, y: 250 },
      { proportional: true, fromCenter: true }
    );
    expect(editor.getSession().transform?.geometry).toEqual({
      x: -200,
      y: -200,
      width: 500,
      height: 500,
    });
  });

  it('leaves rotated resize frames on their local axes', () => {
    const shape = { ...moving, transform: rotation(Math.PI / 4) };
    const snapping = createGraphicsEditor([shape, target], {
      objectSnapping: true,
    });
    const free = createGraphicsEditor([shape, target]);
    for (const editor of [snapping, free]) {
      editor.beginTransform('moving', { x: 0, y: 141.421 }, 'se');
      editor.updateTransform({ x: 298, y: 250 });
    }
    expect(snapping.getSession().transform?.geometry).toEqual(
      free.getSession().transform?.geometry
    );
    expect(snapping.getSession().transform?.snapGuides).toEqual([]);
  });

  it.each(['diagonal', 'row', 'column'])(
    'prunes distant objects on a large %s scene',
    (layout) => {
      const keys = sortKeysBetween(null, null, 10001);
      const editor = createGraphicsEditor(
        Array.from({ length: 10001 }, (_, i) => ({
          ...moving,
          id: String(i),
          placement: { parentId: 'scene-root', sortKey: keys[i]! },
          transform: translation(
            layout === 'column' ? 0 : i * 1000,
            layout === 'row' ? 0 : i * 1000
          ),
        }))
      );
      const snapper = createObjectSnapper(editor.document, ['0']);
      const result = snapper.snap(
        {
          x: layout === 'column' ? 0 : 898,
          y: layout === 'row' ? 0 : 898,
          width: 100,
          height: 100,
        },
        1
      );
      expect(result.offset[layout === 'column' ? 'y' : 'x']).toBe(2);
      expect(snapper.stats().targets).toBe(10001);
      expect(snapper.stats().queries).toBe(6);
      expect(snapper.stats().candidates).toBeLessThan(20);
      expect(snapper.stats().visited).toBeLessThan(400);
    }
  );
});
