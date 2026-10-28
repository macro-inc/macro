/**
 * Series colors as theme tokens, assigned in this order and never cycled,
 * ordered so neighbours stay apart under color-vision deficiency (worst
 * adjacent deutan ΔE 9.8). Amber and yellow are too light to read as marks.
 */
export const CHART_PALETTE = [
  'var(--color-blue)',
  'var(--color-orange)',
  'var(--color-teal)',
  'var(--color-purple)',
  'var(--color-red)',
  'var(--color-cyan)',
  'var(--color-pink)',
  'var(--color-green)',
  'var(--color-violet)',
] as const;
