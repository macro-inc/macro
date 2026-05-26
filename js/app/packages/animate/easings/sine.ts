import type { EasingFn } from '../types/types';

export const sineIn: EasingFn = (t) => 1 - Math.cos((t * Math.PI) / 2);

export const sineOut: EasingFn = (t) => Math.sin((t * Math.PI) / 2);

export const sineInOut: EasingFn = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
