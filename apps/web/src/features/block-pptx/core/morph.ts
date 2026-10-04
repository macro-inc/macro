/**
 * The Morph transition: which objects of two slides are "the same" and how
 * each one travels from its place on the first slide to its place on the
 * second. Matching follows PowerPoint's rules: names starting with `!!`
 * pair exactly, then objects of the same kind with the same name (what
 * duplicating a slide keeps), then the same text, then the same
 * placeholder.
 */

import type { ShapeOutline, SlideOutline } from '@core/pptx-engine/types';
import type { Rect } from './selection';

export interface MorphPair {
  from: ShapeOutline;
  to: ShapeOutline;
}

export interface MorphPlan {
  /** Objects on both slides, in the second slide's stacking order. */
  pairs: MorphPair[];
  /** Objects only on the first slide (they fade out). */
  leaving: ShapeOutline[];
  /** Objects only on the second slide, back to front (they fade in). */
  entering: ShapeOutline[];
}

/** A shape's text, for matching text boxes whose names differ. */
function textOf(shape: ShapeOutline): string {
  return (shape.paragraphs ?? [])
    .map((p) => p.text)
    .join('\n')
    .trim();
}

/**
 * Pairs the top-level objects of `from` and `to`. Hidden objects and the
 * ids in `skipFrom` / `skipTo` (objects an animation hides at that moment)
 * take no part.
 */
export function morphPlan(
  from: SlideOutline,
  to: SlideOutline,
  skipFrom: ReadonlySet<number> = new Set(),
  skipTo: ReadonlySet<number> = new Set()
): MorphPlan {
  const a = from.shapes.filter((s) => !s.hidden && !skipFrom.has(s.id));
  const b = to.shapes.filter((s) => !s.hidden && !skipTo.has(s.id));
  const taken = new Set<ShapeOutline>();
  const partner = new Map<ShapeOutline, ShapeOutline>();
  const rules: ((x: ShapeOutline, y: ShapeOutline) => boolean)[] = [
    (x, y) => x.name.startsWith('!!') && x.name === y.name,
    (x, y) =>
      !x.name.startsWith('!!') && x.name === y.name && x.kind === y.kind,
    (x, y) => x.kind === y.kind && textOf(x) !== '' && textOf(x) === textOf(y),
    (x, y) =>
      x.placeholder !== undefined &&
      x.placeholder === y.placeholder &&
      x.kind === y.kind,
  ];
  for (const rule of rules)
    for (const y of b) {
      if (partner.has(y)) continue;
      const x = a.find((s) => !taken.has(s) && rule(s, y));
      if (!x) continue;
      taken.add(x);
      partner.set(y, x);
    }
  return {
    pairs: b
      .filter((y) => partner.has(y))
      .map((y) => ({ from: partner.get(y)!, to: y })),
    leaving: a.filter((x) => !taken.has(x)),
    entering: b.filter((y) => !partner.has(y)),
  };
}

/** Room around a shape for its outline, shadow, and glow, in points. */
export const SPRITE_MARGIN = 24;

/**
 * The part of the slide a shape's sprite covers: its rotated box plus
 * `margin`, clipped to the slide. `undefined` when none of it is on the
 * slide.
 */
export function spriteRect(
  shape: Pick<ShapeOutline, 'x' | 'y' | 'w' | 'h' | 'rotation'>,
  slide: { w: number; h: number },
  margin = SPRITE_MARGIN
): Rect | undefined {
  const cx = shape.x + shape.w / 2;
  const cy = shape.y + shape.h / 2;
  const t = (shape.rotation * Math.PI) / 180;
  const hw =
    (Math.abs(Math.cos(t)) * shape.w + Math.abs(Math.sin(t)) * shape.h) / 2;
  const hh =
    (Math.abs(Math.sin(t)) * shape.w + Math.abs(Math.cos(t)) * shape.h) / 2;
  const x0 = Math.max(0, cx - hw - margin);
  const y0 = Math.max(0, cy - hh - margin);
  const x1 = Math.min(slide.w, cx + hw + margin);
  const y1 = Math.min(slide.h, cy + hh + margin);
  if (x1 <= x0 || y1 <= y0) return undefined;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** `b - a` in degrees, taking the short way round (-180..180]. */
export function turn(a: number, b: number): number {
  const d = (((b - a) % 360) + 360) % 360;
  return d > 180 ? d - 360 : d;
}

/**
 * Whether a shape is only text (no fill, not a picture): its text keeps its
 * size and reflows when the box changes, so Morph moves it without
 * stretching.
 */
export function textOnly(
  shape: Pick<ShapeOutline, 'kind' | 'fill' | 'paragraphs'>
): boolean {
  return (
    shape.kind !== 'picture' &&
    !shape.fill &&
    textOf(shape as ShapeOutline) !== ''
  );
}

type Box = Pick<
  ShapeOutline,
  'x' | 'y' | 'w' | 'h' | 'rotation' | 'flipH' | 'flipV'
>;

const size = (v: number) => Math.max(v, 0.5);
const fmt = (v: number) => Number(v.toFixed(4));

function transform(
  dx: number,
  dy: number,
  rotate: number,
  sx: number,
  sy: number,
  unrotate: number
): string {
  return `translate(${fmt(dx)}px, ${fmt(dy)}px) rotate(${fmt(rotate)}deg) scale(${fmt(sx)}, ${fmt(sy)}) rotate(${fmt(-unrotate)}deg)`;
}

/**
 * The CSS transforms (start, end) that carry a picture of `a` — drawn where
 * `a` sits, transformed about its center — onto `b`'s place, size, and
 * rotation, with `k` CSS pixels per point; with `keepSize` it moves and
 * turns without stretching. Every frame uses the same function list, so
 * the browser interpolates each number in step.
 */
export function morphFrames(
  a: Box,
  b: Box,
  k: number,
  keepSize = false
): [string, string] {
  const dx = (b.x + b.w / 2 - (a.x + a.w / 2)) * k;
  const dy = (b.y + b.h / 2 - (a.y + a.h / 2)) * k;
  const end = a.rotation + turn(a.rotation, b.rotation);
  const sx =
    (keepSize ? 1 : size(b.w) / size(a.w)) * (a.flipH === b.flipH ? 1 : -1);
  const sy =
    (keepSize ? 1 : size(b.h) / size(a.h)) * (a.flipV === b.flipV ? 1 : -1);
  return [
    transform(0, 0, a.rotation, 1, 1, a.rotation),
    transform(dx, dy, end, sx, sy, a.rotation),
  ];
}
