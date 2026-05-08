import { type Accessor, createEffect, onCleanup } from 'solid-js';
import { createStore, produce } from 'solid-js/store';
import type { CollapsibleRegistration, HeaderCollapser } from '../context';

const OVERFLOW_EPSILON_PX = 2;
const UNCOLLAPSE_HYSTERESIS_PX = 12;

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
  let requiredPanelWidth: number | null = null;

  const scheduleEvaluate = () => {
    if (evaluateQueued) return;
    evaluateQueued = true;
    rafId = requestAnimationFrame(() => {
      evaluateQueued = false;
      rafId = null;
      evaluate();
    });
  };

  const setAllCollapsed = (value: boolean) => {
    for (const item of items) {
      if (item.collapsed() !== value) item.setCollapsed(value);
    }
  };

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
    const overflowAmount = contentWidth - availableWidth;
    const overflow = overflowAmount > OVERFLOW_EPSILON_PX;
    const panelWidth = panelSizeWidth() ?? availableWidth;

    const anyUncollapsed = items.some((i) => !i.collapsed());
    const anyCollapsed = items.some((i) => i.collapsed());

    if (overflow && anyUncollapsed) {
      requiredPanelWidth = panelWidth + Math.max(0, overflowAmount);
      setAllCollapsed(true);
      scheduleEvaluate();
      return;
    }

    if (
      anyCollapsed &&
      requiredPanelWidth !== null &&
      panelWidth >= requiredPanelWidth + UNCOLLAPSE_HYSTERESIS_PX
    ) {
      setAllCollapsed(false);
      requiredPanelWidth = null;
      scheduleEvaluate();
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
      return () => {
        setItems(
          produce((arr: CollapsibleRegistration[]) => {
            const idx = arr.findIndex((i) => i.id === reg.id);
            if (idx !== -1) arr.splice(idx, 1);
          })
        );
      };
    },
  };
}
