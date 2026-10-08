/**
 * PowerPoint's rulers and gridlines: ruler ticks measured from the slide's
 * center in inches (eighths, quarters, halves, and labelled inches, thinned
 * as the zoom shrinks), and gridlines at the grid spacing or a multiple of
 * it that stays readable. Units are points unless named otherwise.
 */

export interface RulerTick {
  /** Position along the slide edge, in points from its start. */
  at: number;
  /** 2 = inch, 1 = half inch, 0 = smaller. */
  weight: 0 | 1 | 2;
  /** Whole inches from the center, on inch ticks. */
  label?: number;
}

const INCH = 72;

/** Ticks for an edge `length` points long shown at `scale` px per point. */
export function rulerTicks(length: number, scale: number): RulerTick[] {
  // The finest of 1/8", 1/4", 1/2", 1" that keeps ticks 5 px apart.
  const step =
    [INCH / 8, INCH / 4, INCH / 2, INCH].find((s) => s * scale >= 5) ?? INCH;
  const center = length / 2;
  const ticks: RulerTick[] = [];
  const reach = Math.floor(center / step);
  for (let i = -reach; i <= reach; i++) {
    const offset = i * step;
    const inches = offset / INCH;
    const whole = Math.abs(inches - Math.round(inches)) < 1e-6;
    const half = !whole && Math.abs(inches * 2 - Math.round(inches * 2)) < 1e-6;
    ticks.push({
      at: center + offset,
      weight: whole ? 2 : half ? 1 : 0,
      ...(whole ? { label: Math.abs(Math.round(inches)) } : {}),
    });
  }
  return ticks;
}

/** Gridline positions along `length`, at `spacing` or a multiple 8 px apart. */
export function gridLines(
  length: number,
  spacing: number,
  scale: number
): number[] {
  if (spacing <= 0 || scale <= 0) return [];
  const step = spacing * Math.max(1, Math.ceil(8 / (spacing * scale)));
  const lines: number[] = [];
  for (let at = step; at < length - 1e-6; at += step) lines.push(at);
  return lines;
}

/** PowerPoint's grid spacings (points), finest first. */
export const GRID_SPACINGS = [
  { value: 6, label: '1/12"' },
  { value: 9, label: '1/8"' },
  { value: 18, label: '1/4"' },
  { value: 36, label: '1/2"' },
  { value: 72, label: '1"' },
  { value: 72 / 2.54 / 2, label: '0.5 cm' },
  { value: 72 / 2.54, label: '1 cm' },
];
