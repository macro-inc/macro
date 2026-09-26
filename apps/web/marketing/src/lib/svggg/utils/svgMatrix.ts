import type { Mat4, Point3D, Transform3D } from '../types/svgTypes';

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);

  const a00 = a[0],
    a01 = a[1],
    a02 = a[2],
    a03 = a[3];
  const a10 = a[4],
    a11 = a[5],
    a12 = a[6],
    a13 = a[7];
  const a20 = a[8],
    a21 = a[9],
    a22 = a[10],
    a23 = a[11];
  const a30 = a[12],
    a31 = a[13],
    a32 = a[14],
    a33 = a[15];

  let b0 = b[0],
    b1 = b[1],
    b2 = b[2],
    b3 = b[3];
  out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

  b0 = b[4];
  b1 = b[5];
  b2 = b[6];
  b3 = b[7];
  out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

  b0 = b[8];
  b1 = b[9];
  b2 = b[10];
  b3 = b[11];
  out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

  b0 = b[12];
  b1 = b[13];
  b2 = b[14];
  b3 = b[15];
  out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
  out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
  out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
  out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

  return out;
}

export function transformPoint3D(point: Point3D, m: Mat4): Point3D {
  const { x, y, z } = point;
  return {
    x: m[0] * x + m[4] * y + m[8] * z + m[12],
    y: m[1] * x + m[5] * y + m[9] * z + m[13],
    z: m[2] * x + m[6] * y + m[10] * z + m[14],
  };
}

export function transformPointsBatch(
  points: Float32Array,
  matrix: Mat4,
  out?: Float32Array
): Float32Array {
  const len = points.length;
  const result = out ?? new Float32Array(len);

  const m0 = matrix[0],
    m1 = matrix[1],
    m2 = matrix[2];
  const m4 = matrix[4],
    m5 = matrix[5],
    m6 = matrix[6];
  const m8 = matrix[8],
    m9 = matrix[9],
    m10 = matrix[10];
  const m12 = matrix[12],
    m13 = matrix[13],
    m14 = matrix[14];

  for (let i = 0; i < len; i += 3) {
    const x = points[i];
    const y = points[i + 1];
    const z = points[i + 2];

    result[i] = m0 * x + m4 * y + m8 * z + m12;
    result[i + 1] = m1 * x + m5 * y + m9 * z + m13;
    result[i + 2] = m2 * x + m6 * y + m10 * z + m14;
  }

  return result;
}

export function transformToMatrix(t: Transform3D, out?: Mat4): Mat4 {
  const result = out ?? new Float32Array(16);
  const { rx, ry, rz, tx, ty, tz, sx, sy, sz, cx, cy, cz } = t;

  const cosX = Math.cos(toRad(rx));
  const sinX = Math.sin(toRad(rx));
  const cosY = Math.cos(toRad(ry));
  const sinY = Math.sin(toRad(ry));
  const cosZ = Math.cos(toRad(rz));
  const sinZ = Math.sin(toRad(rz));

  const r00 = cosZ * cosY;
  const r01 = cosZ * sinY * sinX - sinZ * cosX;
  const r02 = cosZ * sinY * cosX + sinZ * sinX;

  const r10 = sinZ * cosY;
  const r11 = sinZ * sinY * sinX + cosZ * cosX;
  const r12 = sinZ * sinY * cosX - cosZ * sinX;

  const r20 = -sinY;
  const r21 = cosY * sinX;
  const r22 = cosY * cosX;

  const m00 = r00 * sx;
  const m01 = r01 * sy;
  const m02 = r02 * sz;

  const m10 = r10 * sx;
  const m11 = r11 * sy;
  const m12 = r12 * sz;

  const m20 = r20 * sx;
  const m21 = r21 * sy;
  const m22 = r22 * sz;

  const fx = tx + cx - (m00 * cx + m01 * cy + m02 * cz);
  const fy = ty + cy - (m10 * cx + m11 * cy + m12 * cz);
  const fz = tz + cz - (m20 * cx + m21 * cy + m22 * cz);

  result[0] = m00;
  result[1] = m10;
  result[2] = m20;
  result[3] = 0;
  result[4] = m01;
  result[5] = m11;
  result[6] = m21;
  result[7] = 0;
  result[8] = m02;
  result[9] = m12;
  result[10] = m22;
  result[11] = 0;
  result[12] = fx;
  result[13] = fy;
  result[14] = fz;
  result[15] = 1;

  return result;
}

export function transformToMatrixYXZ(t: Transform3D, out?: Mat4): Mat4 {
  const result = out ?? new Float32Array(16);
  const { rx, ry, rz, tx, ty, tz, sx, sy, sz, cx, cy, cz } = t;

  const cosPitch = Math.cos(toRad(rx));
  const sinPitch = Math.sin(toRad(rx));
  const cosYaw = Math.cos(toRad(ry));
  const sinYaw = Math.sin(toRad(ry));
  const cosRoll = Math.cos(toRad(rz));
  const sinRoll = Math.sin(toRad(rz));

  const r00 = cosYaw * cosRoll + sinYaw * sinPitch * sinRoll;
  const r01 = -cosYaw * sinRoll + sinYaw * sinPitch * cosRoll;
  const r02 = sinYaw * cosPitch;

  const r10 = cosPitch * sinRoll;
  const r11 = cosPitch * cosRoll;
  const r12 = -sinPitch;

  const r20 = -sinYaw * cosRoll + cosYaw * sinPitch * sinRoll;
  const r21 = sinYaw * sinRoll + cosYaw * sinPitch * cosRoll;
  const r22 = cosYaw * cosPitch;

  const m00 = r00 * sx;
  const m01 = r01 * sy;
  const m02 = r02 * sz;

  const m10 = r10 * sx;
  const m11 = r11 * sy;
  const m12 = r12 * sz;

  const m20 = r20 * sx;
  const m21 = r21 * sy;
  const m22 = r22 * sz;

  const fx = tx + cx - (m00 * cx + m01 * cy + m02 * cz);
  const fy = ty + cy - (m10 * cx + m11 * cy + m12 * cz);
  const fz = tz + cz - (m20 * cx + m21 * cy + m22 * cz);

  result[0] = m00;
  result[1] = m10;
  result[2] = m20;
  result[3] = 0;
  result[4] = m01;
  result[5] = m11;
  result[6] = m21;
  result[7] = 0;
  result[8] = m02;
  result[9] = m12;
  result[10] = m22;
  result[11] = 0;
  result[12] = fx;
  result[13] = fy;
  result[14] = fz;
  result[15] = 1;

  return result;
}
