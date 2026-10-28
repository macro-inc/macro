import { describe, expect, it } from 'vitest';
import { horizontalInsertion } from './horizontal-insertion';

describe('horizontalInsertion', () => {
  it('lands before an item when the pointer is over its left half', () => {
    expect(
      horizontalInsertion({
        pointer: { x: 210, y: 20 },
        viewport: { left: 0, right: 600, top: 0, bottom: 40 },
        items: [
          { id: 'a', rect: { left: 0, right: 100, top: 0, bottom: 40 } },
          { id: 'b', rect: { left: 100, right: 200, top: 0, bottom: 40 } },
          { id: 'c', rect: { left: 200, right: 300, top: 0, bottom: 40 } },
        ],
        draggedId: 'a',
      })
    ).toEqual({ targetId: 'c', edge: 'before', boundary: 200 });
  });

  it('lands after an item when the pointer is over its right half', () => {
    expect(
      horizontalInsertion({
        pointer: { x: 280, y: 20 },
        viewport: { left: 0, right: 600, top: 0, bottom: 40 },
        items: [
          { id: 'a', rect: { left: 0, right: 100, top: 0, bottom: 40 } },
          { id: 'b', rect: { left: 100, right: 200, top: 0, bottom: 40 } },
          { id: 'c', rect: { left: 200, right: 300, top: 0, bottom: 40 } },
        ],
        draggedId: 'a',
      })
    ).toEqual({ targetId: 'c', edge: 'after', boundary: 300 });
  });

  it('lands after the last item when the pointer is past every item', () => {
    expect(
      horizontalInsertion({
        pointer: { x: 500, y: 20 },
        viewport: { left: 0, right: 600, top: 0, bottom: 40 },
        items: [
          { id: 'a', rect: { left: 0, right: 100, top: 0, bottom: 40 } },
          { id: 'b', rect: { left: 100, right: 200, top: 0, bottom: 40 } },
          { id: 'c', rect: { left: 200, right: 300, top: 0, bottom: 40 } },
        ],
        draggedId: 'a',
      })
    ).toEqual({ targetId: 'c', edge: 'after', boundary: 300 });
  });

  it('lands nowhere when the pointer leaves the viewport', () => {
    expect(
      horizontalInsertion({
        pointer: { x: 250, y: 60 },
        viewport: { left: 0, right: 600, top: 0, bottom: 40 },
        items: [
          { id: 'a', rect: { left: 0, right: 100, top: 0, bottom: 40 } },
          { id: 'b', rect: { left: 100, right: 200, top: 0, bottom: 40 } },
          { id: 'c', rect: { left: 200, right: 300, top: 0, bottom: 40 } },
        ],
        draggedId: 'a',
      })
    ).toBeUndefined();
    expect(
      horizontalInsertion({
        pointer: { x: 650, y: 20 },
        viewport: { left: 0, right: 600, top: 0, bottom: 40 },
        items: [
          { id: 'a', rect: { left: 0, right: 100, top: 0, bottom: 40 } },
          { id: 'b', rect: { left: 100, right: 200, top: 0, bottom: 40 } },
          { id: 'c', rect: { left: 200, right: 300, top: 0, bottom: 40 } },
        ],
        draggedId: 'a',
      })
    ).toBeUndefined();
  });

  it('allows the pointer to stray above or below the viewport by the slack', () => {
    expect(
      horizontalInsertion({
        pointer: { x: 240, y: 60 },
        viewport: { left: 0, right: 600, top: 0, bottom: 40 },
        verticalSlack: 24,
        items: [
          { id: 'a', rect: { left: 0, right: 100, top: 0, bottom: 40 } },
          { id: 'b', rect: { left: 100, right: 200, top: 0, bottom: 40 } },
          { id: 'c', rect: { left: 200, right: 300, top: 0, bottom: 40 } },
        ],
        draggedId: 'a',
      })
    ).toEqual({ targetId: 'c', edge: 'before', boundary: 200 });
    expect(
      horizontalInsertion({
        pointer: { x: 240, y: -30 },
        viewport: { left: 0, right: 600, top: 0, bottom: 40 },
        verticalSlack: 24,
        items: [
          { id: 'a', rect: { left: 0, right: 100, top: 0, bottom: 40 } },
          { id: 'b', rect: { left: 100, right: 200, top: 0, bottom: 40 } },
          { id: 'c', rect: { left: 200, right: 300, top: 0, bottom: 40 } },
        ],
        draggedId: 'a',
      })
    ).toBeUndefined();
  });

  it('refuses a boundary scrolled out of the viewport only when asked to', () => {
    expect(
      horizontalInsertion({
        pointer: { x: 15, y: 20 },
        viewport: { left: 10, right: 600, top: 0, bottom: 40 },
        boundaryInViewport: true,
        items: [
          { id: 'a', rect: { left: -10, right: 50, top: 0, bottom: 40 } },
          { id: 'b', rect: { left: 50, right: 150, top: 0, bottom: 40 } },
          { id: 'c', rect: { left: 150, right: 250, top: 0, bottom: 40 } },
        ],
        draggedId: 'c',
      })
    ).toBeUndefined();
    expect(
      horizontalInsertion({
        pointer: { x: 15, y: 20 },
        viewport: { left: 10, right: 600, top: 0, bottom: 40 },
        items: [
          { id: 'a', rect: { left: -10, right: 50, top: 0, bottom: 40 } },
          { id: 'b', rect: { left: 50, right: 150, top: 0, bottom: 40 } },
          { id: 'c', rect: { left: 150, right: 250, top: 0, bottom: 40 } },
        ],
        draggedId: 'c',
      })
    ).toEqual({ targetId: 'a', edge: 'before', boundary: -10 });
  });

  it('lands nowhere beside the dragged item itself', () => {
    expect(
      horizontalInsertion({
        pointer: { x: 120, y: 20 },
        viewport: { left: 0, right: 600, top: 0, bottom: 40 },
        items: [
          { id: 'a', rect: { left: 0, right: 100, top: 0, bottom: 40 } },
          { id: 'b', rect: { left: 100, right: 200, top: 0, bottom: 40 } },
          { id: 'c', rect: { left: 200, right: 300, top: 0, bottom: 40 } },
        ],
        draggedId: 'b',
      })
    ).toBeUndefined();
    expect(
      horizontalInsertion({
        pointer: { x: 80, y: 20 },
        viewport: { left: 0, right: 600, top: 0, bottom: 40 },
        items: [
          { id: 'a', rect: { left: 0, right: 100, top: 0, bottom: 40 } },
          { id: 'b', rect: { left: 100, right: 200, top: 0, bottom: 40 } },
          { id: 'c', rect: { left: 200, right: 300, top: 0, bottom: 40 } },
        ],
        draggedId: 'b',
      })
    ).toBeUndefined();
    expect(
      horizontalInsertion({
        pointer: { x: 220, y: 20 },
        viewport: { left: 0, right: 600, top: 0, bottom: 40 },
        items: [
          { id: 'a', rect: { left: 0, right: 100, top: 0, bottom: 40 } },
          { id: 'b', rect: { left: 100, right: 200, top: 0, bottom: 40 } },
          { id: 'c', rect: { left: 200, right: 300, top: 0, bottom: 40 } },
        ],
        draggedId: 'b',
      })
    ).toBeUndefined();
  });

  it('lands nowhere when the dragged item is not in the row', () => {
    expect(
      horizontalInsertion({
        pointer: { x: 250, y: 20 },
        viewport: { left: 0, right: 600, top: 0, bottom: 40 },
        items: [
          { id: 'a', rect: { left: 0, right: 100, top: 0, bottom: 40 } },
          { id: 'b', rect: { left: 100, right: 200, top: 0, bottom: 40 } },
        ],
        draggedId: 'missing',
      })
    ).toBeUndefined();
  });
});
