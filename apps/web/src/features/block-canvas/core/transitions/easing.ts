import type { TransitionEasing } from '@macro-inc/graphics';

type CurvePoints = readonly [number, number, number, number];

/** The CSS keyword curves, so a transition eases the same in WAAPI and in
 * sampled camera paths. */
const CURVES: Record<TransitionEasing, CurvePoints> = {
  linear: [0, 0, 1, 1],
  ease: [0.25, 0.1, 0.25, 1],
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
};

export function easingCss(easing: TransitionEasing): string {
  if (easing === 'linear') return 'linear';

  const [x1, y1, x2, y2] = CURVES[easing];
  return `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`;
}

/**
 * Evaluates the easing at progress `t`. A cubic Bézier gives x and y as
 * functions of a curve parameter, so solve x(u) = t for u (Newton steps, then
 * bisection when the slope is too flat), and return y(u).
 */
export function easingFunction(
  easing: TransitionEasing
): (t: number) => number {
  const [x1, y1, x2, y2] = CURVES[easing];
  if (easing === 'linear') return (t) => clamp01(t);

  const coordinate = (u: number, p1: number, p2: number) =>
    3 * (1 - u) * (1 - u) * u * p1 + 3 * (1 - u) * u * u * p2 + u * u * u;
  const slope = (u: number, p1: number, p2: number) =>
    3 * (1 - u) * (1 - u) * p1 +
    6 * (1 - u) * u * (p2 - p1) +
    3 * u * u * (1 - p2);

  return (input) => {
    const t = clamp01(input);
    if (t === 0 || t === 1) return t;

    let u = t;
    for (let step = 0; step < 8; step++) {
      const error = coordinate(u, x1, x2) - t;
      if (Math.abs(error) < 1e-7) return coordinate(u, y1, y2);

      const derivative = slope(u, x1, x2);
      if (Math.abs(derivative) < 1e-6) break;
      u -= error / derivative;
    }

    let low = 0;
    let high = 1;
    u = t;
    for (let step = 0; step < 40; step++) {
      const x = coordinate(u, x1, x2);
      if (Math.abs(x - t) < 1e-7) break;
      if (x < t) low = u;
      else high = u;
      u = (low + high) / 2;
    }
    return coordinate(u, y1, y2);
  };
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
