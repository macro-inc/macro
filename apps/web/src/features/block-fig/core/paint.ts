/**
 * Paint editing as the design panel does it: the paint kinds Figma's paint
 * picker switches between, gradient stops (added by clicking the stop bar,
 * dragged, removed), the order of a layer's paints, and stroke dashes.
 */

import type { PaintInfo, StopInfo } from '@core/fig-engine/types';
import { hexToRgba, rgbaToHex } from './color';

export type PaintType =
  | 'SOLID'
  | 'GRADIENT_LINEAR'
  | 'GRADIENT_RADIAL'
  | 'GRADIENT_ANGULAR'
  | 'GRADIENT_DIAMOND'
  | 'IMAGE';

export const PAINT_TYPES: readonly { value: PaintType; label: string }[] = [
  { value: 'SOLID', label: 'Solid' },
  { value: 'GRADIENT_LINEAR', label: 'Linear' },
  { value: 'GRADIENT_RADIAL', label: 'Radial' },
  { value: 'GRADIENT_ANGULAR', label: 'Angular' },
  { value: 'GRADIENT_DIAMOND', label: 'Diamond' },
  { value: 'IMAGE', label: 'Image' },
];

export const isGradient = (type: string) => type.startsWith('GRADIENT_');

/** A stop's color with its alpha, `RRGGBB[AA]`. */
export function stopHex(stop: StopInfo): string {
  return rgbaToHex({ ...hexToRgba(stop.color), a: stop.alpha });
}

/** A stop as the engine takes it. */
export interface StopSpec {
  color: string;
  position: number;
}

export const stopSpecs = (stops: StopInfo[]): StopSpec[] =>
  stops.map((s) => ({ color: stopHex(s), position: s.position }));

/** The gradient's color at `position`, between its stops. */
export function colorAt(stops: StopInfo[], position: number): string {
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) return '000000';
  if (position <= first.position) return stopHex(first);
  if (position >= last.position) return stopHex(last);
  const k = sorted.findIndex((s) => s.position >= position);
  const a = sorted[k - 1];
  const b = sorted[k];
  const t = (position - a.position) / (b.position - a.position || 1);
  const ca = hexToRgba(stopHex(a));
  const cb = hexToRgba(stopHex(b));
  const mix = (x: number, y: number) => x + (y - x) * t;
  return rgbaToHex({
    r: mix(ca.r, cb.r),
    g: mix(ca.g, cb.g),
    b: mix(ca.b, cb.b),
    a: mix(ca.a, cb.a),
  });
}

const sortStops = (stops: StopSpec[], moved: StopSpec) => {
  const sorted = [...stops].sort((a, b) => a.position - b.position);
  return { stops: sorted, index: sorted.indexOf(moved) };
};

/**
 * Adds a stop where the stop bar was clicked, in the gradient's color
 * there; returns the stops and the new one's index.
 */
export function addStop(stops: StopInfo[], position: number) {
  const p = Math.min(1, Math.max(0, position));
  const added = { color: colorAt(stops, p), position: p };
  return sortStops([...stopSpecs(stops), added], added);
}

/** Moves stop `index` along the bar; returns the stops and its new index. */
export function moveStop(stops: StopInfo[], index: number, position: number) {
  const specs = stopSpecs(stops);
  const moved = specs[index];
  if (!moved) return { stops: specs, index };
  moved.position = Math.min(1, Math.max(0, Math.round(position * 1000) / 1000));
  return sortStops(specs, moved);
}

/** Recolors stop `index` (`RRGGBB[AA]`). */
export function recolorStop(stops: StopInfo[], index: number, hex: string) {
  return stopSpecs(stops).map((s, k) =>
    k === index ? { ...s, color: hex } : s
  );
}

/** Removes stop `index`; a gradient keeps two stops at least. */
export function removeStop(stops: StopInfo[], index: number) {
  if (stops.length <= 2) return undefined;
  return stopSpecs(stops).filter((_, k) => k !== index);
}

/** An edit of one paint, as `PaintSpec` fields. */
export interface PaintEdit {
  keep?: number;
  type?: PaintType;
  image?: string;
  color?: string;
  opacity?: number;
  visible?: boolean;
  stops?: StopSpec[];
}

/**
 * Specs keeping every paint, with `edit` applied to the one at `index`
 * (`null` removes it).
 */
export function editPaint(
  paints: PaintInfo[],
  index: number,
  edit: (spec: PaintEdit, paint: PaintInfo) => PaintEdit | null
): PaintEdit[] {
  const out: PaintEdit[] = [];
  paints.forEach((p, k) => {
    const spec: PaintEdit = { keep: k };
    const next = k === index ? edit(spec, p) : spec;
    if (next) out.push(next);
  });
  return out;
}

/**
 * Specs moving the paint at `from` to `to` (indices bottom first, as the
 * engine orders paints).
 */
export function movePaint(
  count: number,
  from: number,
  to: number
): PaintEdit[] {
  const order = Array.from({ length: count }, (_, k) => k);
  const [moved] = order.splice(from, 1);
  if (moved === undefined) return order.map((keep) => ({ keep }));
  order.splice(Math.min(Math.max(0, to), order.length), 0, moved);
  return order.map((keep) => ({ keep }));
}

/** `4, 2` for a dash pattern; empty for a solid stroke. */
export function formatDashes(dashes: number[] | null | undefined): string {
  return dashes && dashes.length > 0 ? dashes.join(', ') : '';
}

/**
 * A typed dash pattern: dash and gap lengths separated by commas or
 * spaces (one number dashes with equal gaps); empty or `0` is solid.
 */
export function parseDashes(text: string): number[] | null {
  const t = text.trim();
  if (t === '' || t === '0') return [];
  const parts = t.split(/[\s,]+/).map(Number);
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.every((n) => n === 0)) return [];
  return parts.length === 1 ? [parts[0], parts[0]] : parts;
}

/**
 * A new paint like `p`, for moving it to the other list (Figma's swap fill
 * and stroke). Gradients keep their stops; unknown kinds are dropped.
 */
export function copyPaint(p: PaintInfo): PaintEdit | null {
  const common = { opacity: p.opacity, visible: p.visible };
  if (p.type === 'SOLID' && p.color)
    return {
      ...common,
      type: 'SOLID',
      color: rgbaToHex({ ...hexToRgba(p.color), a: p.alpha ?? 1 }),
    };
  if (isGradient(p.type) && p.stops)
    return { ...common, type: p.type as PaintType, stops: stopSpecs(p.stops) };
  if (p.type === 'IMAGE' && p.imageHash)
    return { ...common, image: p.imageHash };
  return null;
}
