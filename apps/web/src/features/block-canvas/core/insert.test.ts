import { expect, it } from 'vitest';
import { canInsertAsset, radialSliceAtPoint } from './insert';

it('limits media to images/videos and allows document references', () => {
  expect(canInsertAsset('media', 'image', false)).toBe(true);
  expect(canInsertAsset('media', 'video', false)).toBe(true);
  expect(canInsertAsset('media', 'pdf', false)).toBe(false);
  expect(canInsertAsset('reference', 'pdf', false)).toBe(true);
});

it('offers artifacts as references only while artifacts are enabled', () => {
  expect(canInsertAsset('reference', 'artifact', true)).toBe(true);
  expect(canInsertAsset('reference', 'artifact', false)).toBe(false);
  expect(canInsertAsset('media', 'artifact', true)).toBe(false);
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
