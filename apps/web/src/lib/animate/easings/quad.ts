import type { EasingFn } from '../types/types';

export const quadIn: EasingFn = (t) => t * t;

export const quadOut: EasingFn = (t) => 1 - (1 - t) * (1 - t);

export const quadInOut: EasingFn = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
