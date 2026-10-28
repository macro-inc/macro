/** Ruler ticks: a step in page units that keeps labels readable. */

const STEPS = [1, 2, 5];

/** The smallest 1/2/5×10ⁿ step at least `minPixels` apart on screen. */
export function rulerStep(zoom: number, minPixels = 64): number {
  const raw = minPixels / zoom;
  const exponent = Math.floor(Math.log10(raw));
  for (let e = exponent; e <= exponent + 1; e++) {
    for (const s of STEPS) {
      const step = s * 10 ** e;
      if (step >= raw) return step;
    }
  }
  return 10 ** (exponent + 1);
}

/** Tick positions (page units) covering `[start, start + span]`. */
export function rulerTicks(
  start: number,
  span: number,
  step: number
): number[] {
  const first = Math.floor(start / step) * step;
  const ticks: number[] = [];
  for (let t = first; t <= start + span && ticks.length < 1000; t += step) {
    ticks.push(Math.round(t / step) * step);
  }
  return ticks;
}
