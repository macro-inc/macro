import { describe, expect, it } from 'vitest';
import { rotationFor } from './rotation';

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
