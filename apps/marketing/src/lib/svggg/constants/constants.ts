import type { Mat4, Transform3D } from '../types/svgTypes';

export const DEFAULT_TRANSFORM: Transform3D = {
  rx: 0,
  ry: 0,
  rz: 0,
  tx: 0,
  ty: 0,
  tz: 0,
  sx: 1,
  sy: 1,
  sz: 1,
  cx: 0,
  cy: 0,
  cz: 0,
};

export const IDENTITY_MATRIX: Mat4 = new Float32Array([
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
]);
