import type { EasingFn, BackOptions } from '../types/types';

export function backIn(opts: BackOptions = {}): EasingFn {
  const { overshoot = 1.70158 } = opts;
  return (t) => (overshoot + 1) * t * t * t - overshoot * t * t;
}

export function backOut(opts: BackOptions = {}): EasingFn {
  const { overshoot = 1.70158 } = opts;
  return (t) => 1 + (overshoot + 1) * Math.pow(t - 1, 3) + overshoot * Math.pow(t - 1, 2);
}

export function backInOut(opts: BackOptions = {}): EasingFn {
  const { overshoot = 1.70158 } = opts;
  const c2 = overshoot * 1.525;
  return (t) => t < 0.5
    ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
    : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
}
