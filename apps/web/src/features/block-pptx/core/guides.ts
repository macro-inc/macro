/**
 * PowerPoint's drawing guides (View ▸ Guides): dashed lines over every slide
 * that shapes snap to. Positions are points from the slide's top (horizontal
 * guides) or left (vertical guides) edge, as the engine's `setGuides` takes
 * them; PowerPoint labels them in inches from the slide's center.
 */

import type {
  GuideOrient,
  GuideOutline,
  GuideSpec,
} from '@core/pptx-engine/types';
import type { Point } from './geometry';
import type { Guides } from './snap';

export interface SlideSize {
  w: number;
  h: number;
}

/** The color PowerPoint gives guides drawn on slides. */
export const DEFAULT_GUIDE_COLOR = 'A4A3A4';

/** Guides move in steps of 1/24 inch, as PowerPoint's do (points). */
export const GUIDE_STEP = 3;

const INCH = 72;

/** The slide's extent along which a guide's position is measured. */
export const guideExtent = (orient: GuideOrient, slide: SlideSize) =>
  orient === 'horizontal' ? slide.h : slide.w;

/** A guide as `setGuides` takes it, keeping its id and color. */
export const specOf = (g: GuideOutline): GuideSpec => ({
  orient: g.orient,
  position: g.position,
  ...(g.color ? { color: g.color } : {}),
  id: g.id,
});

/** The guide nearest `at` within `tolerance` points, by index. */
export function guideAt(
  guides: GuideOutline[],
  at: Point,
  tolerance: number
): number | undefined {
  let best: { index: number; distance: number } | undefined;
  guides.forEach((g, index) => {
    const distance = Math.abs(
      (g.orient === 'horizontal' ? at.y : at.x) - g.position
    );
    if (distance <= tolerance && (!best || distance < best.distance))
      best = { index, distance };
  });
  return best?.index;
}

/**
 * Where a guide dragged to `at` goes: the pointer's coordinate across the
 * guide, in `step`s (0 or less for no steps), and whether the pointer left
 * the slide (a guide dragged off the slide is deleted).
 */
export function dragPosition(
  orient: GuideOrient,
  at: Point,
  slide: SlideSize,
  step: number
): { position: number; off: boolean } {
  const extent = guideExtent(orient, slide);
  const raw = orient === 'horizontal' ? at.y : at.x;
  const off = raw < 0 || raw > extent;
  const center = extent / 2;
  // Steps count from the center, where PowerPoint measures from.
  const stepped =
    step > 0 ? center + Math.round((raw - center) / step) * step : raw;
  return { position: Math.min(extent, Math.max(0, stepped)), off };
}

/**
 * PowerPoint's guide tooltip: the distance from the slide's center in
 * inches, with an arrow pointing away from the center.
 */
export function guideLabel(
  orient: GuideOrient,
  position: number,
  slide: SlideSize
): string {
  const offset = (position - guideExtent(orient, slide) / 2) / INCH;
  const value = Math.abs(offset).toFixed(2);
  if (value === '0.00') return '0.00';
  if (orient === 'vertical') return offset < 0 ? `← ${value}` : `${value} →`;
  return offset < 0 ? `↑ ${value}` : `${value} ↓`;
}

/** The list after guide `index` moves to `position` (or a copy goes there). */
export function moveGuide(
  guides: GuideOutline[],
  index: number,
  position: number,
  copy: boolean
): GuideSpec[] {
  const list = guides.map(specOf);
  const moved = list[index];
  if (!moved) return list;
  if (copy) {
    const color = moved.color ? { color: moved.color } : {};
    return [...list, { orient: moved.orient, position, ...color }];
  }
  list[index] = { ...moved, position };
  return list;
}

/** The list without guide `index`. */
export const removeGuide = (
  guides: GuideOutline[],
  index: number
): GuideSpec[] => guides.filter((_, i) => i !== index).map(specOf);

/** The list with guide `index` in `color` (`RRGGBB` or a theme name). */
export const recolorGuide = (
  guides: GuideOutline[],
  index: number,
  color: string
): GuideSpec[] =>
  guides.map((g, i) => (i === index ? { ...specOf(g), color } : specOf(g)));

/**
 * Where a new guide goes: the slide's center, or the first free spot half
 * an inch at a time to either side of it.
 */
export function newGuidePosition(
  guides: GuideOutline[],
  orient: GuideOrient,
  slide: SlideSize
): number {
  const extent = guideExtent(orient, slide);
  const center = extent / 2;
  const taken = (p: number) =>
    guides.some((g) => g.orient === orient && Math.abs(g.position - p) < 0.5);
  for (let k = 0; k <= 2 * Math.ceil(extent / (INCH / 2)); k++) {
    const side = k % 2 === 1 ? 1 : -1;
    const p = center + side * Math.ceil(k / 2) * (INCH / 2);
    if (p >= 0 && p <= extent && !taken(p)) return p;
  }
  return center;
}

/** The list with a new guide of `orient`. */
export const addGuide = (
  guides: GuideOutline[],
  orient: GuideOrient,
  slide: SlideSize
): GuideSpec[] => [
  ...guides.map(specOf),
  { orient, position: newGuidePosition(guides, orient, slide) },
];

/** Snap lines for shapes moved near guides. */
export function guideLines(guides: GuideOutline[]): Guides {
  return {
    xs: guides.filter((g) => g.orient === 'vertical').map((g) => g.position),
    ys: guides.filter((g) => g.orient === 'horizontal').map((g) => g.position),
  };
}
