import { type Vector2, vec2 } from './vector2';

const { max, min } = Math;

export function clamp(x: number, mn: number, mx: number) {
  return max(min(mx, x), mn);
}

export function lerp(a: number, b: number, t: number) {
  return a * (1 - t) + b * t;
}

export function easeInOutCubic(t: number) {
  let r = clamp(t, 0, 1);
  return r < 0.5 ? 4 * r * r * r : 1 - Math.pow(-2 * r + 2, 3) / 2;
}

export function remap(
  x: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number
) {
  return ((x - inMin) * (outMax - outMin)) / (inMax - inMin) + outMin;
}

export const degreesToRadians = (deg: number) => deg * (Math.PI / 180);

export const radiansToDegrees = (rad: number) => rad * (180 / Math.PI);

export const snapTo = (x: number, step: number) => {
  if (step === 0) return x;
  return Math.round(x / step) * step;
};

export function cubicBezierPoint(
  p0: Vector2,
  p1: Vector2,
  p2: Vector2,
  p3: Vector2,
  t: number
) {
  // B(t) = (1-t)³P₀ + 3(1-t)²tP₁ + 3(1-t)t²P₂ + t³P₃
  const oneMinusT = 1 - t;
  const oneMinusTSquared = oneMinusT * oneMinusT;
  const oneMinusTCubed = oneMinusTSquared * oneMinusT;
  const tSquared = t * t;
  const tCubed = tSquared * t;
  const x =
    oneMinusTCubed * p0.x +
    3 * oneMinusTSquared * t * p1.x +
    3 * oneMinusT * tSquared * p2.x +
    tCubed * p3.x;
  const y =
    oneMinusTCubed * p0.y +
    3 * oneMinusTSquared * t * p1.y +
    3 * oneMinusT * tSquared * p2.y +
    tCubed * p3.y;
  return vec2(x, y);
}
