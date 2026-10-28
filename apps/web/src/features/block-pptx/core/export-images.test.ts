import { describe, expect, it } from 'vitest';
import {
  baseName,
  cropBox,
  exportIndexes,
  slideFileName,
} from './export-images';

describe('exporting slides as pictures', () => {
  it('picks slides', () => {
    expect(exportIndexes('all', 1, [], 3)).toEqual([0, 1, 2]);
    expect(exportIndexes('current', 1, [0, 2], 3)).toEqual([1]);
    expect(exportIndexes('selected', 1, [2, 0, 2, 7], 3)).toEqual([0, 2]);
    expect(exportIndexes('selected', 1, [], 3)).toEqual([1]);
  });

  it('names files like PowerPoint', () => {
    expect(baseName('Q3 review.pptx')).toBe('Q3 review');
    expect(baseName('a/b:c.PPTX')).toBe('a-b-c');
    expect(baseName('.pptx')).toBe('Presentation');
    expect(slideFileName('Q3.pptx', 2, 'png', false)).toBe('Slide3.png');
    expect(slideFileName('Q3.pptx', 0, 'jpeg', true)).toBe('Q3 - Slide1.jpg');
  });

  it('crops to a shape, clamped to the render', () => {
    expect(
      cropBox({ x: 10.2, y: 5, w: 20, h: 10 }, 2, { w: 100, h: 100 })
    ).toEqual({
      x: 20,
      y: 10,
      w: 41,
      h: 20,
    });
    expect(
      cropBox({ x: -5, y: 90, w: 20, h: 40 }, 1, { w: 100, h: 100 })
    ).toEqual({
      x: 0,
      y: 90,
      w: 15,
      h: 10,
    });
  });
});
