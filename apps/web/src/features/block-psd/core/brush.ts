/**
 * Brush settings as the options bar and Brush Settings panel hold them,
 * and the engine brush each painting tool uses: the brush paints, the
 * pencil paints hard aliased dabs, the eraser removes pixels.
 */

import type { Brush, Rgb } from '@core/psd-engine/types';

export interface BrushSettings {
  /** Diameter in canvas pixels. */
  size: number;
  /** `0..=1`. */
  hardness: number;
  /** `0..=1`. */
  opacity: number;
  /** `0..=1`. */
  flow: number;
  /** Fraction of the size between dabs. */
  spacing: number;
  /** Pen pressure scales the size. */
  pressureSize: boolean;
  /** Pen pressure scales the flow. */
  pressureOpacity: boolean;
}

export const DEFAULT_BRUSH: BrushSettings = {
  size: 20,
  hardness: 1,
  opacity: 1,
  flow: 1,
  spacing: 0.25,
  pressureSize: true,
  pressureOpacity: false,
};

export type PaintingTool = 'brush' | 'pencil' | 'eraser';

/** The engine brush for a tool, its settings, and a color. */
export function brushFor(
  tool: PaintingTool,
  settings: BrushSettings,
  color: Rgb
): Brush {
  return {
    size: Math.min(5000, Math.max(1, settings.size)),
    hardness: tool === 'pencil' ? 1 : settings.hardness,
    opacity: settings.opacity,
    flow: tool === 'pencil' ? 1 : settings.flow,
    spacing: settings.spacing,
    color,
    mode: tool === 'eraser' ? 'erase' : 'paint',
    pencil: tool === 'pencil',
    pressureSize: settings.pressureSize,
    pressureOpacity: settings.pressureOpacity,
  };
}

/**
 * A pointer's pressure for painting: a pen's own, full for a mouse (which
 * reports 0.5 while pressed) and for touch without pressure.
 */
export function pressureOf(e: { pointerType: string; pressure: number }) {
  if (e.pointerType !== 'pen') return 1;
  return e.pressure > 0 ? Math.min(1, e.pressure) : 1;
}

/** A stroke id: random, so two people's strokes never share one. */
export function newStrokeId(random: () => number = Math.random): number {
  return 1 + Math.floor(random() * 0xfffffffe);
}
