import { type Accessor, createEffect, onCleanup } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import type { CollapsibleRegistration, HeaderCollapser } from '../context';

const OVERFLOW_EPSILON_PX = 2;
const RETRY_PANEL_GROWTH_PX = 12;

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
  let observer: ResizeObserver | null = null;
  let rafId: number | null = null;
  let evaluateQueued = false;
  let lastFailedExpand: { contentWidth: number; panelWidth: number } | null =
    null;

  const scheduleEvaluate = () => {
    if (evaluateQueued) return;
    evaluateQueued = true;
    rafId = requestAnimationFrame(() => {
      evaluateQueued = false;
      rafId = null;
      evaluate();
    });
  };

  const overflows = (headerLeft: HTMLElement) =>
    getContentWidth(headerLeft) - headerLeft.offsetWidth > OVERFLOW_EPSILON_PX;

  const evaluate = () => {
    const headerLeft = getContainer();
    if (!headerLeft) return;

    if (!observer) {
      observer = new ResizeObserver(() => scheduleEvaluate());
      observer.observe(headerLeft);
    }

    if (items.length === 0) return;

    const contentWidth = getContentWidth(headerLeft);
    const availableWidth = headerLeft.offsetWidth;
    const panelWidth = panelSizeWidth() ?? availableWidth;

    if (contentWidth - availableWidth > OVERFLOW_EPSILON_PX) {
      const byCollapseOrder = items
        .filter((i) => !i.collapsed())
        .sort((a, b) => a.priority - b.priority);
      for (const item of byCollapseOrder) {
        item.setCollapsed(true);
        if (!overflows(headerLeft)) break;
      }
      lastFailedExpand = {
        contentWidth: getContentWidth(headerLeft),
        panelWidth,
      };
      return;
    }

    const byExpandOrder = items
      .filter((i) => i.collapsed())
      .sort((a, b) => b.priority - a.priority);
    if (byExpandOrder.length === 0) return;

    if (
      lastFailedExpand &&
      contentWidth === lastFailedExpand.contentWidth &&
      panelWidth < lastFailedExpand.panelWidth + RETRY_PANEL_GROWTH_PX
    ) {
      return;
    }

    // Trial expansion runs between layout and paint, so a reverted attempt is
    // never visible; silent keeps onCollapsedChange from firing for it.
    for (const item of byExpandOrder) {
      item.setCollapsed(false, { silent: true });
      if (overflows(headerLeft)) {
        item.setCollapsed(true, { silent: true });
        lastFailedExpand = {
          contentWidth: getContentWidth(headerLeft),
          panelWidth,
        };
        break;
      }
      item.setCollapsed(false);
    }
  };

  createEffect(() => {
    panelSizeWidth();
    scheduleEvaluate();
  });

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
      lastFailedExpand = null;
      return () => {
        setItems(
          produce((arr: CollapsibleRegistration[]) => {
            const idx = arr.findIndex((i) => i.id === reg.id);
            if (idx !== -1) arr.splice(idx, 1);
          })
        );
        lastFailedExpand = null;
      };
    },
  };
}
