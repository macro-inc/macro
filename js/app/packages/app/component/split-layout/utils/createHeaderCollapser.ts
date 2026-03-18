import { type Accessor, createEffect, onCleanup } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import type { CollapsibleRegistration, HeaderCollapser } from '../context';

/**
 * Returns the actual rendered content width of a container's children.
 *
 * Layout-transparent wrapper elements
 * (e.g. Portal divs with `display: contents`) are skipped and their real
 * children are measured directly.
 */
function getContentWidth(container: HTMLElement): number {
  let itemTotal = 0;
  let itemCount = 0;
  for (const child of Array.from(container.children) as HTMLElement[]) {
    if (getComputedStyle(child).display === 'contents') {
      for (const inner of Array.from(child.children) as HTMLElement[]) {
        itemTotal += inner.offsetWidth;
        itemCount++;
      }
    } else {
      itemTotal += child.offsetWidth;
      itemCount++;
    }
  }
  // Include padding and flex gap so spare matches scrollWidth-based overflow detection.
  const style = getComputedStyle(container);
  const paddingLeft = parseFloat(style.paddingLeft) || 0;
  const paddingRight = parseFloat(style.paddingRight) || 0;
  const gap = parseFloat(style.columnGap) || 0;
  return (
    itemTotal + paddingLeft + paddingRight + gap * Math.max(0, itemCount - 1)
  );
}

export function createHeaderCollapser(
  getContainer: Accessor<HTMLElement | undefined>,
  panelSizeWidth: Accessor<number | null | undefined>
): HeaderCollapser {
  const [items, setItems] = createStore<CollapsibleRegistration[]>([]);
  const naturalWidths = new Map<string, number>();
  const collapsedWidths = new Map<string, number>();
  let observer: ResizeObserver | null = null;

  const evaluate = () => {
    const headerLeft = getContainer();
    if (!headerLeft) return;

    // Attach ResizeObserver lazily on first call when headerLeft exists
    if (!observer) {
      observer = new ResizeObserver(() => queueMicrotask(evaluate));
      observer.observe(headerLeft);
    }

    // Measure widths of items in their current state
    for (const item of items) {
      if (!item.collapsed()) {
        const el = item.ref();
        if (el) naturalWidths.set(item.id, el.offsetWidth);
      } else {
        const el = item.collapsedRef?.();
        if (el) collapsedWidths.set(item.id, el.offsetWidth);
      }
    }

    const overflow = headerLeft.scrollWidth > headerLeft.offsetWidth;

    if (overflow) {
      // Collapse the first uncollapsed item (lowest priority number)
      const uncollapsed = [...items]
        .filter((item) => !item.collapsed())
        .sort((a, b) => a.priority - b.priority);
      if (uncollapsed.length > 0) {
        uncollapsed[0].setCollapsed(true);
        queueMicrotask(evaluate);
      }
    } else {
      // Try to uncollapse the last-collapsed item (highest priority number = collapsed last)
      const collapsed = [...items]
        .filter((item) => item.collapsed())
        .sort((a, b) => b.priority - a.priority);
      if (collapsed.length > 0) {
        const item = collapsed[0];
        // Use Infinity if we've never measured this item — don't uncollapse blindly
        const naturalWidth = naturalWidths.get(item.id) ?? Infinity;
        // The net extra space headerRight needs = naturalWidth minus the collapsed
        // element's current footprint (the icon button that will disappear on uncollapse).
        const collapsedWidth = collapsedWidths.get(item.id) ?? 0;
        const needed = naturalWidth - collapsedWidth;
        // The container is flex-grow so scrollWidth === offsetWidth when no overflow —
        // measure the actual rendered content width instead.
        const contentWidth = getContentWidth(headerLeft);
        const spare = headerLeft.offsetWidth - contentWidth;
        if (spare >= needed + 1) {
          item.setCollapsed(false);
          queueMicrotask(evaluate);
        }
      }
    }
  };

  // Re-evaluate when panel width changes
  createEffect(() => {
    panelSizeWidth();
    queueMicrotask(evaluate);
  });

  // Re-evaluate when any item's collapsed state changes
  // (scrollWidth changes but ResizeObserver doesn't fire for this)
  createEffect(() => {
    for (const item of items) {
      item.collapsed();
    }
    queueMicrotask(evaluate);
  });

  onCleanup(() => observer?.disconnect());

  return {
    register(reg: CollapsibleRegistration) {
      setItems(produce((arr: CollapsibleRegistration[]) => arr.push(reg)));
      return () => {
        setItems(
          produce((arr: CollapsibleRegistration[]) => {
            const idx = arr.findIndex((i) => i.id === reg.id);
            if (idx !== -1) arr.splice(idx, 1);
          })
        );
        naturalWidths.delete(reg.id);
        collapsedWidths.delete(reg.id);
      };
    },
  };
}
