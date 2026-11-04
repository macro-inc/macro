import { expect, it } from 'vitest';
import { canInsertAsset, radialSliceAtPoint } from './insert';

it('limits media to images/videos and allows document references', () => {
  expect(canInsertAsset('media', 'image')).toBe(true);
  expect(canInsertAsset('media', 'video')).toBe(true);
  expect(canInsertAsset('media', 'pdf')).toBe(false);
  expect(canInsertAsset('reference', 'pdf')).toBe(true);
});

it('divides a full turn into equal slices and keeps the center neutral', () => {
  expect(radialSliceAtPoint(0, -100, 3)).toBe(0);
  expect(radialSliceAtPoint(100, 50, 3)).toBe(1);
  expect(radialSliceAtPoint(-100, 50, 3)).toBe(2);
  expect(radialSliceAtPoint(-1, 100, 3)).toBe(2);
  expect(radialSliceAtPoint(1, 100, 3)).toBe(1);
  expect(radialSliceAtPoint(10, 10, 3)).toBeUndefined();
  expect(radialSliceAtPoint(100, 0, 4)).toBe(1);
  expect(radialSliceAtPoint(0, 100, 4)).toBe(2);
  expect(radialSliceAtPoint(-100, 0, 4)).toBe(3);
});
