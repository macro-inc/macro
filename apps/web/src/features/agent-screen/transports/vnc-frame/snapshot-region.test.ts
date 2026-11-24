import { describe, expect, it } from 'vitest';
import { snapshotCopy } from './snapshot-region';

describe('snapshotCopy', () => {
  it('copies only the part of a loupe region that is on the canvas', () => {
    const canvas = { width: 1920, height: 1080 };
    // Fully inside.
    expect(
      snapshotCopy(canvas, { x: 100, y: 200, width: 168, height: 96 })
    ).toEqual({
      source: { x: 100, y: 200, width: 168, height: 96 },
      offsetX: 0,
      offsetY: 0,
    });
    // Finger at the top-left corner: the region starts off the canvas.
    expect(
      snapshotCopy(canvas, { x: -84, y: -48, width: 168, height: 96 })
    ).toEqual({
      source: { x: 0, y: 0, width: 84, height: 48 },
      offsetX: 84,
      offsetY: 48,
    });
    // Bottom-right corner.
    expect(
      snapshotCopy(canvas, { x: 1836, y: 1032, width: 168, height: 96 })
    ).toEqual({
      source: { x: 1836, y: 1032, width: 84, height: 48 },
      offsetX: 0,
      offsetY: 0,
    });
    // Nothing on the canvas (no frame yet).
    expect(
      snapshotCopy(
        { width: 0, height: 0 },
        { x: 0, y: 0, width: 168, height: 96 }
      )
    ).toBe(undefined);
  });
});
