import { describe, expect, it } from 'vitest';
import { verticalInsertion } from './vertical-insertion';

describe('verticalInsertion', () => {
  it('lands above an item over its top half and below it over its bottom half', () => {
    expect(
      verticalInsertion({
        pointer: { x: 100, y: 75 },
        viewport: { left: 0, right: 300, top: 0, bottom: 200 },
        items: [
          { id: 'a', rect: { left: 0, right: 300, top: 0, bottom: 40 } },
          { id: 'b', rect: { left: 0, right: 300, top: 40, bottom: 80 } },
          { id: 'c', rect: { left: 0, right: 300, top: 80, bottom: 120 } },
        ],
        draggedId: 'a',
      })
    ).toEqual({ targetId: 'b', edge: 'after', boundary: 80 });
    expect(
      verticalInsertion({
        pointer: { x: 100, y: 85 },
        viewport: { left: 0, right: 300, top: 0, bottom: 200 },
        items: [
          { id: 'a', rect: { left: 0, right: 300, top: 0, bottom: 40 } },
          { id: 'b', rect: { left: 0, right: 300, top: 40, bottom: 80 } },
          { id: 'c', rect: { left: 0, right: 300, top: 80, bottom: 120 } },
        ],
        draggedId: 'a',
      })
    ).toEqual({ targetId: 'c', edge: 'before', boundary: 80 });
  });

  it('lands nowhere beside the dragged item or outside the viewport', () => {
    expect(
      verticalInsertion({
        pointer: { x: 100, y: 45 },
        viewport: { left: 0, right: 300, top: 0, bottom: 200 },
        items: [
          { id: 'a', rect: { left: 0, right: 300, top: 0, bottom: 40 } },
          { id: 'b', rect: { left: 0, right: 300, top: 40, bottom: 80 } },
        ],
        draggedId: 'a',
      })
    ).toBeUndefined();
    expect(
      verticalInsertion({
        pointer: { x: 320, y: 75 },
        viewport: { left: 0, right: 300, top: 0, bottom: 200 },
        items: [
          { id: 'a', rect: { left: 0, right: 300, top: 0, bottom: 40 } },
          { id: 'b', rect: { left: 0, right: 300, top: 40, bottom: 80 } },
        ],
        draggedId: 'a',
      })
    ).toBeUndefined();
  });
});
