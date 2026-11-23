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

/**
 * Whether a row neither overflows nor wraps a child onto a second line.
 * Children without a box of their own (`display: contents` wrappers, hidden
 * controls) have an empty rect, so they are left out of the line check.
 */
export function fitsOnOneLine(row: HTMLElement): boolean {
  if (row.scrollWidth > row.clientWidth + 1) return false;
  const [first, ...rest] = Array.from(row.children).filter(
    (child) => child.getClientRects().length > 0
  );
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
 *
 * `watchContent` also measures again when a control in the row changes size
 * while the row's width does not, such as a search field opening in it.
 */
export function createLabelCollapse(
  row: Accessor<HTMLElement | undefined>,
  order: Accessor<readonly string[]>,
  options: { watchContent?: boolean } = {}
) {
  const [count, setCount] = createSignal(0);
  let width: number | undefined;
  let frame: number | undefined;
  let skipOwnChanges = () => {};

  const measure = () => {
    frame = undefined;
    const element = row();
    if (!element) return;
    collapseUntilFits(untrack(order).length, setCount, () =>
      fitsOnOneLine(element)
    );
    // The elements this measure showed and hid are not new content.
    skipOwnChanges();
  };

  // Collapsing changes the row's height, never its width; skipping
  // height-only changes keeps the observer from re-entering itself.
  createResizeObserver(row, (rect) => {
    if (rect.width === width) return;
    width = rect.width;
    measure();
  });
  const schedule = () => {
    if (frame === undefined) frame = requestAnimationFrame(measure);
  };
  // New controls render before the next frame; measure them then.
  createEffect(on(order, schedule, { defer: true }));
  if (options.watchContent) skipOwnChanges = watchChildren(row, schedule);
  // A web font that swaps in widens the labels without resizing the row.
  document.fonts?.addEventListener('loadingdone', schedule);
  onCleanup(() => {
    document.fonts?.removeEventListener('loadingdone', schedule);
    if (frame !== undefined) cancelAnimationFrame(frame);
  });

  return (id: string) => {
    const index = order().indexOf(id);
    return index !== -1 && index < count();
  };
}

/**
 * The row's laid-out items: its children, with `display: contents` wrappers
 * replaced by what they hold.
 */
function rowItems(element: Element): Element[] {
  return Array.from(element.children).flatMap((child) =>
    getComputedStyle(child).display === 'contents' ? rowItems(child) : [child]
  );
}

/**
 * Calls `onChange` when an item of the row resizes, or elements come and go
 * anywhere in it (a control a group shows only on some tabs). Returns a
 * function that drops the changes made since the last call, so the caller's
 * own collapsing does not report itself.
 */
function watchChildren(
  row: Accessor<HTMLElement | undefined>,
  onChange: () => void
): () => void {
  let skipPending = () => {};
  createEffect(
    on(row, (element) => {
      if (!element) return;
      const sizes = new ResizeObserver(onChange);
      let observed: Element[] = [];
      // Observing reports each item's size once, which measures again, so
      // only a changed set of items is observed anew.
      const observeChildren = () => {
        const items = rowItems(element);
        if (
          items.length === observed.length &&
          items.every((item, index) => item === observed[index])
        )
          return;
        observed = items;
        sizes.disconnect();
        for (const item of items) sizes.observe(item);
      };
      const children = new MutationObserver(() => {
        observeChildren();
        onChange();
      });
      observeChildren();
      children.observe(element, { childList: true, subtree: true });
      skipPending = () => {
        children.takeRecords();
        observeChildren();
      };
      onCleanup(() => {
        sizes.disconnect();
        children.disconnect();
        skipPending = () => {};
      });
    })
  );
  return () => skipPending();
}
