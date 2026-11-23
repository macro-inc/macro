/** Geometry shared by both the native scroller and its selection band. */
export const WHEEL_ROW_HEIGHT = 44;
export const WHEEL_VISIBLE_ROWS = 5;
export const WHEEL_PADDING = (WHEEL_VISIBLE_ROWS - 1) / 2;
// A pixel-sized native runway keeps short cycles from hitting an edge in a fling.
// Labels are recycled; its snap anchors stay fixed until scrolling settles.
export const WHEEL_LOOP_RUNWAY_PX = 131_072;

export interface WheelOption {
  value: string;
  label: string;
}

export function wheelValueIndex(index: number, count: number) {
  return count > 0 ? ((index % count) + count) % count : 0;
}

export function wheelRowCount(count: number, loop: boolean) {
  if (!loop || count === 0) return count;
  return Math.ceil(WHEEL_LOOP_RUNWAY_PX / (WHEEL_ROW_HEIGHT * count)) * count;
}

export function wheelCenterIndex(index: number, count: number, loop: boolean) {
  if (!loop || count === 0) return index;
  const copies = wheelRowCount(count, true) / count;
  return Math.floor(copies / 2) * count + index;
}

export function wheelVisibleRows(position: number, rowCount: number) {
  const start = Math.max(0, Math.floor(position) - WHEEL_PADDING - 1);
  const end = Math.min(rowCount, Math.ceil(position) + WHEEL_PADDING + 2);
  return Array.from(
    { length: Math.max(0, end - start) },
    (_, index) => start + index
  );
}

export function wheelSnapIndex(
  scrollTop: number,
  count: number,
  loop: boolean
) {
  const rows = wheelRowCount(count, loop);
  return Math.max(
    0,
    Math.min(rows - 1, Math.round(scrollTop / WHEEL_ROW_HEIGHT))
  );
}

/** Keep type on the shared scale while fading emphasis through a fling. */
export function wheelRowStyle(distance: number) {
  const near = Math.min(1, Math.abs(distance));
  const far = Math.max(0, Math.min(1, Math.abs(distance) - 1));
  const centered = Math.abs(distance) < 0.5;
  return {
    'font-size': centered ? 'var(--text-lg)' : 'var(--text-base)',
    'line-height': centered
      ? 'var(--text-lg--line-height)'
      : 'var(--text-base--line-height)',
    'font-weight': 600 - near * 200,
    color:
      near < 1
        ? `color-mix(in srgb, var(--color-accent) ${(1 - near) * 100}%, var(--color-ink-muted))`
        : `color-mix(in srgb, var(--color-ink-muted) ${(1 - far) * 100}%, var(--color-ink-subtle))`,
    opacity: Math.max(
      0,
      1 - far * 0.4 - Math.max(0, Math.abs(distance) - 2) * 0.6
    ),
  };
}
