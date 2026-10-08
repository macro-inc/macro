import { describe, expect, it } from 'vitest';
import { isAxisAligned, resizedOrigin, rotationFor } from './rotation';

describe('rotation drags', () => {
  it('turns counter-clockwise for positive degrees, as Figma shows them', () => {
    // Dragging a quarter turn clockwise on screen.
    expect(rotationFor(0, 0, Math.PI / 2, false)).toBe(-90);
    expect(rotationFor(10, Math.PI / 2, 0, false)).toBe(100);
  });

  it('wraps to ±180 and snaps to 15° with shift', () => {
    expect(rotationFor(170, 0, -Math.PI / 6, false)).toBe(-160);
    expect(rotationFor(0, 0, -0.2, true)).toBe(15);
  });
});

describe('resizing axis-aligned layers', () => {
  it('treats half turns (vertical flips) as axis-aligned', () => {
    expect(isAxisAligned(0)).toBe(true);
    expect(isAxisAligned(-180)).toBe(true);
    expect(isAxisAligned(180)).toBe(true);
    expect(isAxisAligned(30)).toBe(false);
  });

  it('moves the panel point with the corner it sits on', () => {
    const from = { x: 10, y: 20, w: 100, h: 50 };
    const to = { x: 10, y: 20, w: 150, h: 80 };
    // Unrotated: the top left corner stays.
    expect(resizedOrigin({ x: 10, y: 20, rotation: 0 }, from, to)).toEqual({
      x: 10,
      y: 20,
    });
    // Half turned: the panel point is the bottom right corner, which moves.
    expect(resizedOrigin({ x: 110, y: 70, rotation: 180 }, from, to)).toEqual({
      x: 160,
      y: 100,
    });
  });
});
