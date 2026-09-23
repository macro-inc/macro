import { expect, it, vi } from 'vitest';
import type { GraphicsDocument } from '../src/core/model';
import { createScene, worldBounds } from '../src/core/scene';
import { createSelection } from '../src/core/selection';

it('runs against an injected document host without an editor or history backend', () => {
  let document: GraphicsDocument = createScene([
    {
      id: 'a',
      type: 'rectangle',
      geometry: { x: 10, y: 20, width: 100, height: 80 },
      appearance: { fill: 'white', stroke: 'black' },
    },
  ]);
  const commit = vi.fn((next: GraphicsDocument) => {
    document = next;
  });
  const changed = vi.fn();
  const selection = createSelection({
    getDocument: () => document,
    commitDocument: commit,
    cancelDrawing: vi.fn(),
    onChange: changed,
  });
  selection.beginTransform('a', { x: 20, y: 30 });
  selection.updateTransform({ x: 40, y: 60 });
  expect(selection.getState().transform?.geometry.x).toBe(30);
  expect(worldBounds(document, 'a').x).toBe(10);
  expect(commit).not.toHaveBeenCalled();
  selection.commitTransform();
  expect(commit).toHaveBeenCalledTimes(1);
  expect(worldBounds(document, 'a').x).toBe(30);
  selection.reconcile(createScene());
  expect(selection.getState().selectedId).toBeUndefined();
  selection.dispose();
  changed.mockClear();
  selection.select('a');
  selection.cancelTransform();
  expect(changed).not.toHaveBeenCalled();
});
