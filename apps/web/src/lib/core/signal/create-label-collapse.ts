import { createResizeObserver } from '@solid-primitives/resize-observer';
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
  untrack,
} from 'solid-js';

/**
 * Collapses labels one at a time until the row fits, starting from none, and
 * returns how many it collapsed: all of them when even that does not fit.
 */
export function collapseUntilFits(
  total: number,
  apply: (count: number) => void,
  fits: () => boolean
): number {
  for (let count = 0; count < total; count++) {
    apply(count);
    if (fits()) return count;
  }
  apply(total);
  return total;
}

/** Whether a row neither overflows nor wraps a child onto a second line. */
export function fitsOnOneLine(row: HTMLElement): boolean {
  if (row.scrollWidth > row.clientWidth + 1) return false;
  const [first, ...rest] = Array.from(row.children);
  if (!first) return true;
  const firstBottom = first.getBoundingClientRect().bottom;
  return rest.every((child) => child.getBoundingClientRect().top < firstBottom);
}

/**
 * Drops the labels of a row of icon-and-label controls one at a time, in
 * `order`, until the row fits on one line, and brings them back as it widens.
 * `collapsed(id)` says which controls show only their icon.
 *
 * Solid updates the DOM synchronously, so each step is measured before the
 * browser paints and the row never shows a wrapped intermediate state.
 */
export function createLabelCollapse(
  row: Accessor<HTMLElement | undefined>,
  order: Accessor<readonly string[]>
) {
  const [count, setCount] = createSignal(0);
  let width: number | undefined;
  let frame: number | undefined;

  const measure = () => {
    frame = undefined;
    const element = row();
    if (!element) return;
    collapseUntilFits(untrack(order).length, setCount, () =>
      fitsOnOneLine(element)
    );
  };

  // Collapsing changes the row's height, never its width; skipping
  // height-only changes keeps the observer from re-entering itself.
  createResizeObserver(row, (rect) => {
    if (rect.width === width) return;
    width = rect.width;
    measure();
  });
  // New controls render before the next frame; measure them then.
  createEffect(
    on(
      order,
      () => {
        if (frame === undefined) frame = requestAnimationFrame(measure);
      },
      { defer: true }
    )
  );
  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame);
  });

  return (id: string) => {
    const index = order().indexOf(id);
    return index !== -1 && index < count();
  };
}
