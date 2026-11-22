/** Geometry shared by both the native scroller and its selection band. */
export const WHEEL_ROW_HEIGHT = 44;
export const WHEEL_VISIBLE_ROWS = 5;
export const WHEEL_PADDING = (WHEEL_VISIBLE_ROWS - 1) / 2;
export const WHEEL_LOOP_COPIES = 9;

export interface WheelOption {
  value: string;
  label: string;
}

export function wheelValueIndex(index: number, count: number) {
  return count > 0 ? ((index % count) + count) % count : 0;
}

export function wheelCenterIndex(index: number, count: number, loop: boolean) {
  return loop ? Math.floor(WHEEL_LOOP_COPIES / 2) * count + index : index;
}

export function wheelSnapIndex(
  scrollTop: number,
  count: number,
  loop: boolean
) {
  const rows = count * (loop ? WHEEL_LOOP_COPIES : 1);
  return Math.max(
    0,
    Math.min(rows - 1, Math.round(scrollTop / WHEEL_ROW_HEIGHT))
  );
}

/** Continuous emphasis avoids a row jumping styles halfway through a fling. */
export function wheelRowStyle(distance: number) {
  const near = Math.min(1, Math.abs(distance));
  const far = Math.max(0, Math.min(1, Math.abs(distance) - 1));
  return {
    'font-size': `${17 - near - far}px`,
    'line-height': `${22 - far * 2}px`,
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
