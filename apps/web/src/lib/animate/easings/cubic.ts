import type { EasingFn } from '../types/types';

export const cubicIn: EasingFn = (t) => t * t * t;

export const cubicOut: EasingFn = (t) => 1 - Math.pow(1 - t, 3);

export const cubicInOut: EasingFn = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
