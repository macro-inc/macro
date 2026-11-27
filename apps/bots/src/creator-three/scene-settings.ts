import type { Look } from '../presets';

/** Motion timings, shared with apps/bots motion.css tokens. */
export const MOTION = {
  quick: 0.14,
  base: 0.22,
  reveal: 0.42,
  out: [0.2, 0.8, 0.2, 1] as [number, number, number, number],
};

export const YAW_PER_STEP = 0.3;
export const CANON = { grid: [96, 120] as const, cell: 2 };

export type V3 = [number, number, number];
export const LIGHTS: Record<
  Look['light'],
  {
    key: V3;
    keyCol: V3;
    fill: V3;
    fillCol: V3;
    rim: V3;
    rimCol: V3;
    sky: V3;
    ground: V3;
    glow: V3;
  }
> = {
  studio: {
    key: [0.55, 0.5, 0.66],
    keyCol: [1.5, 1.2, 0.92],
    fill: [-0.8, 0.1, 0.5],
    fillCol: [0.05, 0.06, 0.09],
    rim: [-0.5, 0.5, -0.7],
    rimCol: [0.5, 0.56, 0.7],
    sky: [0.11, 0.105, 0.11],
    ground: [0.07, 0.045, 0.03],
    glow: [0.34, 0.15, 0.05],
  },
  rembrandt: {
    key: [0.78, 0.58, 0.32],
    keyCol: [1.65, 1.2, 0.78],
    fill: [-0.8, 0.1, 0.5],
    fillCol: [0.09, 0.06, 0.04],
    rim: [-0.6, 0.4, -0.7],
    rimCol: [0.6, 0.42, 0.25],
    sky: [0.13, 0.1, 0.08],
    ground: [0.08, 0.05, 0.03],
    glow: [0.3, 0.13, 0.04],
  },
  split: {
    key: [1, 0.12, 0.08],
    keyCol: [1.6, 1.5, 1.4],
    fill: [-0.8, 0.1, 0.5],
    fillCol: [0.02, 0.025, 0.035],
    rim: [-0.5, 0.6, -0.7],
    rimCol: [0.25, 0.28, 0.34],
    sky: [0.06, 0.065, 0.075],
    ground: [0.03, 0.025, 0.02],
    glow: [0.12, 0.08, 0.06],
  },
  rim: {
    key: [0.3, 0.4, 0.85],
    keyCol: [0.32, 0.36, 0.44],
    fill: [-0.8, 0.1, 0.5],
    fillCol: [0.04, 0.05, 0.08],
    rim: [-0.75, 0.45, -0.5],
    rimCol: [2.2, 2.6, 3.2],
    sky: [0.07, 0.085, 0.12],
    ground: [0.03, 0.03, 0.04],
    glow: [0.05, 0.1, 0.19],
  },
};
