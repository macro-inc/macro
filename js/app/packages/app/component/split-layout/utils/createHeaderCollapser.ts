import { type Accessor, createEffect, onCleanup } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import type { CollapsibleRegistration, HeaderCollapser } from '../context';

const OVERFLOW_EPSILON_PX = 2;
const UNCOLLAPSE_HYSTERESIS_PX = 12;

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
  let rafId: number | null = null;
  let evaluateQueued = false;

  const scheduleEvaluate = () => {
    if (evaluateQueued) return;
    evaluateQueued = true;
    rafId = requestAnimationFrame(() => {
      evaluateQueued = false;
      rafId = null;
      evaluate();
    });
  };

  const evaluate = () => {
    const headerLeft = getContainer();
    if (!headerLeft) return;

    // Attach ResizeObserver lazily on first call when headerLeft exists
    if (!observer) {
      observer = new ResizeObserver(() => scheduleEvaluate());
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

    const contentWidth = getContentWidth(headerLeft);
    const availableWidth = headerLeft.offsetWidth;
    const overflowAmount = contentWidth - availableWidth;
    const spare = availableWidth - contentWidth;
    const overflow = overflowAmount > OVERFLOW_EPSILON_PX;

    if (overflow) {
      // Collapse the first uncollapsed item (lowest priority number)
      const uncollapsed = [...items]
        .filter((item) => !item.collapsed())
        .sort((a, b) => a.priority - b.priority);
      if (uncollapsed.length > 0) {
        uncollapsed[0].setCollapsed(true);
        scheduleEvaluate();
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
        // Require real spare room before uncollapsing so widths near the
        // threshold do not bounce between states on every resize/layout pass.
        if (spare >= needed + UNCOLLAPSE_HYSTERESIS_PX) {
          item.setCollapsed(false);
          scheduleEvaluate();
        }
      }
    }
  };

  // Re-evaluate when panel width changes
  createEffect(() => {
    panelSizeWidth();
    scheduleEvaluate();
  });

  // Re-evaluate when any item's collapsed state changes
  // (scrollWidth changes but ResizeObserver doesn't fire for this)
  createEffect(() => {
    for (const item of items) {
      item.collapsed();
    }
    scheduleEvaluate();
  });

  onCleanup(() => {
    observer?.disconnect();
    if (rafId !== null) cancelAnimationFrame(rafId);
  });

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
