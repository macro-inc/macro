import type { ChartKind } from '@macro-inc/spreadsheet/sheet-drawings';
import type { scaleLinear } from 'd3-scale';

/** Shapes a chart draws, in pixels within its box; the view only paints. */
export type ChartShape =
  | {
      type: 'rect';
      x: number;
      y: number;
      width: number;
      height: number;
      fill: string;
      /** An outline, such as the line between touching histogram bins. */
      stroke?: string;
      tip?: string;
    }
  | {
      type: 'path';
      d: string;
      /** Where the path's origin is drawn. */
      translate?: [number, number];
      fill?: string;
      stroke?: string;
      strokeWidth?: number;
      opacity?: number;
      /** A dash pattern, in pixels. */
      dash?: string;
      tip?: string;
    }
  | {
      type: 'circle';
      x: number;
      y: number;
      r: number;
      fill: string;
      opacity?: number;
      stroke?: string;
      tip?: string;
    }
  | {
      type: 'line';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      /** Gridlines and axes use theme colors. */
      role: 'grid' | 'axis';
    }
  | {
      type: 'text';
      x: number;
      y: number;
      text: string;
      anchor: 'start' | 'middle' | 'end';
      size: number;
      /** `inside` text is written over a filled shape. */
      role: 'title' | 'label' | 'inside';
      baseline?: 'middle' | 'hanging' | 'auto';
      bold?: boolean;
    };

export type ChartScene = { shapes: ChartShape[] };

export const CHARACTER_WIDTH = 0.6;

export function truncate(text: string, width: number, size: number): string {
  const fits = Math.max(1, Math.floor(width / (size * CHARACTER_WIDTH)));
  return text.length > fits ? `${text.slice(0, Math.max(1, fits - 1))}…` : text;
}

/** Tick labels formatted like the series' cells: percentages, currency. */
export function tickFormat(sample: string | undefined, step: number) {
  const digits = step >= 1 ? 0 : Math.min(4, Math.ceil(-Math.log10(step)));
  const percent = !!sample?.trim().endsWith('%');
  const currency = /^-?\(?([$€£¥])/.exec(sample?.trim() ?? '')?.[1];
  const format = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: percent ? Math.max(0, digits - 2) : digits,
    ...(percent && { style: 'percent' }),
  });
  return (value: number) => {
    const text = format.format(value);
    if (!currency) return text;
    return value < 0 ? `-${currency}${text.slice(1)}` : `${currency}${text}`;
  };
}

export type Box = { top: number; bottom: number; left: number; right: number };
export type Scale = ReturnType<typeof scaleLinear<number, number>>;

/**
 * A value axis over values from `low` to `high`: from zero, as Excel starts
 * one, unless the values sit far from it.
 */
export function axisDomain(low: number, high: number): [number, number] {
  if (!Number.isFinite(low) || !Number.isFinite(high)) return [0, 1];
  if (low > 0 && (high - low) / high >= 1 / 6) low = 0;
  if (high < 0 && (low - high) / low >= 1 / 6) high = 0;
  if (low === high)
    return low === 0 ? [0, 1] : [Math.min(0, low), Math.max(0, high)];
  return [low, high];
}

/**
 * Excel's default gaps between the bars of its 2016 charts, in percent of a
 * bar's width (a funnel's, of a bar's height).
 */
export const DEFAULT_GAP_WIDTHS: Partial<Record<ChartKind, number>> = {
  histogram: 0,
  pareto: 0,
  waterfall: 50,
  boxWhisker: 100,
  funnel: 6,
};
