import type { EasingFn } from '../types/types';

export const bounceIn: EasingFn = (t) => 1 - bounceOut(1 - t);

export const bounceOut: EasingFn = (t) => {
  if (t < 1 / 2.75) return 7.5625 * t * t;
  if (t < 2 / 2.75) {
    const t2 = t - 1.5 / 2.75;
    return 7.5625 * t2 * t2 + 0.75;
  }
  if (t < 2.5 / 2.75) {
    const t2 = t - 2.25 / 2.75;
    return 7.5625 * t2 * t2 + 0.9375;
  }
  const t2 = t - 2.625 / 2.75;
  return 7.5625 * t2 * t2 + 0.984375;
};

export const bounceInOut: EasingFn = (t) => t < 0.5
  ? (1 - bounceOut(1 - 2 * t)) / 2
  : (1 + bounceOut(2 * t - 1)) / 2;
