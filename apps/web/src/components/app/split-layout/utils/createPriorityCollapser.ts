import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';

const OVERFLOW_EPSILON_PX = 2;
const RETRY_WIDTH_GROWTH_PX = 12;

export type CollapsibleRegistration = {
  id: string;
  /** Lower numbers collapse first. */
  priority: number;
  collapsed: Accessor<boolean>;
  /** `silent` suppresses callbacks during pre-paint trial measurements. */
  setCollapsed: (value: boolean, options?: { silent?: boolean }) => void;
};

export type CollapsibleItemInput = Omit<
  CollapsibleRegistration,
  'collapsed' | 'setCollapsed'
> & {
  onCollapsedChange?: (isCollapsed: boolean) => void;
};

export type PriorityCollapser = {
  register: (registration: CollapsibleRegistration) => () => void;
};

/** Widths used by the priority-collapse policy. */
export type OverflowMeasurement = {
  /** Intrinsic width required by the flexible region's content. */
  requiredWidth: number;
  /** Width currently available to the flexible region. */
  availableWidth: number;
  /** Width whose growth should permit another failed expansion attempt. */
  retryWidth: number;
};

/**
 * Measurement boundary consumed by the priority-collapse policy.
 *
 * Implementations own all environment-specific observation and measurement;
 * the controller only asks for a width snapshot and an invalidation callback.
 */
export type OverflowProbe = {
  measure: () => OverflowMeasurement | undefined;
  observe: (onChange: () => void) => () => void;
};

/**
 * Collapse registered items in priority order until the supplied probe fits,
 * and expand them in reverse order as space returns.
 *
 * This controller is headless: it has no DOM knowledge. The probe determines
 * what constitutes required, available, and retry width.
 */
export function createPriorityCollapser(
  probe: OverflowProbe
): PriorityCollapser {
  const [items, setItems] = createSignal<CollapsibleRegistration[]>([]);
  let rafId: number | null = null;
  let evaluateQueued = false;
  let lastFailedExpand: {
    requiredWidth: number;
    retryWidth: number;
  } | null = null;

  const overflows = () => {
    const measurement = probe.measure();
    return (
      measurement !== undefined &&
      measurement.requiredWidth - measurement.availableWidth >
        OVERFLOW_EPSILON_PX
    );
  };

  const evaluate = () => {
    const measurement = probe.measure();
    if (!measurement || items().length === 0) return;

    if (
      measurement.requiredWidth - measurement.availableWidth >
      OVERFLOW_EPSILON_PX
    ) {
      const byCollapseOrder = items()
        .filter((item) => !item.collapsed())
        .sort((a, b) => a.priority - b.priority);
      for (const item of byCollapseOrder) {
        item.setCollapsed(true);
        if (!overflows()) break;
      }

      const collapsedMeasurement = probe.measure();
      if (collapsedMeasurement) {
        lastFailedExpand = {
          requiredWidth: collapsedMeasurement.requiredWidth,
          retryWidth: collapsedMeasurement.retryWidth,
        };
      }
      return;
    }

    const byExpandOrder = items()
      .filter((item) => item.collapsed())
      .sort((a, b) => b.priority - a.priority);
    if (byExpandOrder.length === 0) return;

    if (
      lastFailedExpand &&
      measurement.requiredWidth === lastFailedExpand.requiredWidth &&
      measurement.retryWidth <
        lastFailedExpand.retryWidth + RETRY_WIDTH_GROWTH_PX
    ) {
      return;
    }

    // Trial expansion runs between layout and paint, so a reverted attempt is
    // never visible; silent keeps onCollapsedChange from firing for it.
    for (const item of byExpandOrder) {
      item.setCollapsed(false, { silent: true });
      if (overflows()) {
        item.setCollapsed(true, { silent: true });
        const collapsedMeasurement = probe.measure();
        if (collapsedMeasurement) {
          lastFailedExpand = {
            requiredWidth: collapsedMeasurement.requiredWidth,
            retryWidth: collapsedMeasurement.retryWidth,
          };
        }
        break;
      }
      item.setCollapsed(false);
    }
  };

  const scheduleEvaluate = () => {
    if (evaluateQueued) return;
    evaluateQueued = true;
    rafId = requestAnimationFrame(() => {
      evaluateQueued = false;
      rafId = null;
      evaluate();
    });
  };

  const stopObserving = probe.observe(scheduleEvaluate);

  createEffect(() => {
    for (const item of items()) {
      item.collapsed();
    }
    scheduleEvaluate();
  });

  onCleanup(() => {
    stopObserving();
    if (rafId !== null) cancelAnimationFrame(rafId);
  });

  return {
    register(registration) {
      setItems((registeredItems) => [...registeredItems, registration]);
      lastFailedExpand = null;
      return () => {
        setItems((registeredItems) =>
          registeredItems.filter((item) => item.id !== registration.id)
        );
        lastFailedExpand = null;
      };
    },
  };
}
