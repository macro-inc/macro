/** Theme palette tokens assigned to seats in order; races seat up to eight. */
const SEAT_TOKENS = [
  'accent',
  'red',
  'green',
  'amber',
  'violet',
  'pink',
  'teal',
  'orange',
] as const;

/** A seat's theme-aware color, usable in inline styles and SVG. */
export function seatColor(seat: number): string {
  return `var(--color-${SEAT_TOKENS[seat % SEAT_TOKENS.length]})`;
}

/** A translucent wash of a seat's color. */
export function seatTint(seat: number, percent: number): string {
  return `color-mix(in oklch, ${seatColor(seat)} ${percent}%, transparent)`;
}
