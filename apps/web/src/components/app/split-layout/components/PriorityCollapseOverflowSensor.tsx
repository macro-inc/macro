import { cn } from '@ui';
import {
  type Accessor,
  createEffect,
  createSignal,
  createUniqueId,
  onCleanup,
  type ParentProps,
} from 'solid-js';
import {
  createPriorityCollapser,
  type OverflowProbe,
  type PriorityCollapser,
} from '../utils/createPriorityCollapser';

/** Collapses only after every real collapse item has already given up its
 * space. */
const TRUNCATE_LAST_RESORT_PRIORITY = Number.MAX_SAFE_INTEGER;

export type PriorityCollapseController = {
  collapser: PriorityCollapser;
  setRow: (element: HTMLElement) => void;
  /** Set the sensor's width-constrained outer measurement element. */
  setViewport: (element: HTMLElement) => void;
  setContent: (element: HTMLElement) => void;
};

/** Adapt explicit row, available-space, and content elements to a probe. */
export function createElementOverflowProbe(options: {
  row: Accessor<HTMLElement | undefined>;
  viewport: Accessor<HTMLElement | undefined>;
  content: Accessor<HTMLElement | undefined>;
}): OverflowProbe {
  return {
    measure: () => {
      const row = options.row();
      const viewport = options.viewport();
      const content = options.content();
      if (!row || !viewport || !content) return undefined;

      return {
        requiredWidth: content.scrollWidth,
        availableWidth: viewport.clientWidth,
        retryWidth: row.clientWidth,
      };
    },
    observe: (onChange) => {
      const observer = new ResizeObserver(onChange);

      createEffect(() => {
        const elements = [
          options.row(),
          options.viewport(),
          options.content(),
        ].filter((element): element is HTMLElement => element !== undefined);

        observer.disconnect();
        for (const element of new Set(elements)) {
          observer.observe(element, { box: 'border-box' });
        }
        onChange();
      });

      return () => observer.disconnect();
    },
  };
}

/** Create the controller and element refs for one priority-collapse row. */
export function createPriorityCollapseController(): PriorityCollapseController {
  const [row, setRow] = createSignal<HTMLElement>();
  const [viewport, setViewport] = createSignal<HTMLElement>();
  const [content, setContent] = createSignal<HTMLElement>();
  const probe = createElementOverflowProbe({ row, viewport, content });

  return {
    collapser: createPriorityCollapser(probe),
    setRow,
    setViewport,
    setContent,
  };
}

/**
 * Overflow sensor for a priority-collapse row.
 *
 * The sensor's outer element is locally width-constrained; its `clientWidth`
 * is the space available to the collapse group. The max-content inner
 * element's `scrollWidth` is the space the group's intrinsic content requires.
 *
 * The row itself remains caller-owned; connect it with `controller.setRow`.
 * The sensor's outer element acts as the pressure gauge for every item
 * registered with the controller. Registered items do not need to be
 * descendants of the sensor; they may live anywhere in the row, provided
 * changing their collapsed state changes the sensor's available width. A
 * region that can overflow without affecting the sensor needs its own
 * controller and sensor.
 *
 * CSS sizing contract: the caller must constrain the sensor's outer element
 * independently of its max-content child. In a flex or grid row, that usually
 * means applying `min-w-0` together with an allocation rule such as `flex-1`
 * or `shrink`.
 */
export function PriorityCollapseOverflowSensor(
  props: ParentProps<{
    controller: PriorityCollapseController;
    class?: string;
    contentClass?: string;
    contentRef?: (element: HTMLDivElement) => void;
    /**
     * Cap the max-content element at the sensor's width as the collapser's
     * last resort. The cap registers as a final collapse item, so it engages
     * only once every other registered item has collapsed and the content
     * still overflows, and it lifts again before any of them re-expands.
     * While capped, shrinkable content (e.g. a title's `truncate` span)
     * ellipsizes instead of painting past the sensor's clipped edge; without
     * it, content that outgrows the fully-collapsed row is clipped mid-glyph.
     */
    truncateAsLastResort?: boolean;
  }>
) {
  const [capped, setCapped] = createSignal(false);

  // Read once by design: the flag decides whether this sensor owns a collapse
  // registration, which can't be torn down and re-created reactively.
  if (props.truncateAsLastResort) {
    onCleanup(
      props.controller.collapser.register({
        id: `truncate-last-resort-${createUniqueId()}`,
        priority: TRUNCATE_LAST_RESORT_PRIORITY,
        collapsed: capped,
        setCollapsed: (value) => setCapped(value),
      })
    );
  }

  const setContentRef = (element: HTMLDivElement) => {
    props.controller.setContent(element);
    props.contentRef?.(element);
  };

  return (
    <div ref={props.controller.setViewport} class={props.class}>
      <div
        ref={setContentRef}
        class={cn('w-max', capped() && 'max-w-full', props.contentClass)}
      >
        {props.children}
      </div>
    </div>
  );
}
