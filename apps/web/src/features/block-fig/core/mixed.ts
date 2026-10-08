/**
 * Several selected layers in the design panel, as Figma shows them: a
 * property they share shows its value, one that differs shows "Mixed";
 * typing a value sets it on all of them.
 */

import type { NodeInfo, PaintInfo } from '@core/fig-engine/types';

/** A shared value, or `MIXED` where the layers differ. */
export const MIXED = 'mixed' as const;
export type Mixed<T> = T | typeof MIXED;

export interface MixedInfo {
  count: number;
  /** Layer types, distinct. */
  types: string[];
  x: Mixed<number>;
  y: Mixed<number>;
  width: Mixed<number>;
  height: Mixed<number>;
  rotation: Mixed<number>;
  /** Top-left corner radius, for layers that have corners. */
  radius: Mixed<number> | undefined;
  opacity: Mixed<number>;
  fills: Mixed<PaintInfo[]>;
  strokes: Mixed<PaintInfo[]>;
  strokeWeight: Mixed<number> | undefined;
  /** Some layer is inside an instance (cannot be moved or resized). */
  inInstance: boolean;
}

const CORNERED = [
  'FRAME',
  'RECTANGLE',
  'ROUNDED_RECTANGLE',
  'SYMBOL',
  'INSTANCE',
];

const same = <T>(values: T[], key: (v: T) => string = JSON.stringify) => {
  const first = values[0];
  if (first === undefined) return MIXED;
  const k = key(first);
  return values.every((v) => key(v) === k) ? first : MIXED;
};

/** A number all layers share (to 1/100), or `MIXED`. */
const sameNumber = (values: number[]): Mixed<number> =>
  same(values, (v) => String(Math.round(v * 100)));

/** Paints compared by what they look like. */
const paintKey = (paints: PaintInfo[]) =>
  JSON.stringify(
    paints.map((p) => [
      p.type,
      p.visible,
      p.opacity,
      p.blendMode,
      p.color,
      p.alpha,
      p.stops,
      p.imageHash,
    ])
  );

export function mergeInfos(infos: NodeInfo[]): MixedInfo | undefined {
  if (infos.length === 0) return undefined;
  const cornered = infos.filter((i) => CORNERED.includes(i.type));
  const stroked = infos.filter((i) => i.strokes.length > 0);
  return {
    count: infos.length,
    types: [...new Set(infos.map((i) => i.type))],
    x: sameNumber(infos.map((i) => i.x)),
    y: sameNumber(infos.map((i) => i.y)),
    width: sameNumber(infos.map((i) => i.width)),
    height: sameNumber(infos.map((i) => i.height)),
    rotation: sameNumber(infos.map((i) => i.rotation)),
    radius:
      cornered.length === infos.length
        ? sameNumber(cornered.map((i) => i.cornerRadius?.top_left ?? 0))
        : undefined,
    opacity: sameNumber(infos.map((i) => i.opacity)),
    fills: same(
      infos.map((i) => i.fills),
      paintKey
    ),
    strokes: same(
      infos.map((i) => i.strokes),
      paintKey
    ),
    strokeWeight:
      stroked.length > 0
        ? sameNumber(stroked.map((i) => i.strokeWeight ?? 0))
        : undefined,
    inInstance: infos.some((i) => i.id.startsWith('I')),
  };
}
