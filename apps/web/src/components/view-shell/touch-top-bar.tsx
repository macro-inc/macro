import { MobileTopEdgeFade } from '@components/app/mobile/MobileEdgeFade';
import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createElementSize } from '@solid-primitives/resize-observer';
import { cn } from '@ui';
import {
  type Accessor,
  createContext,
  createEffect,
  createUniqueId,
  type JSX,
  onCleanup,
  type ParentProps,
  Show,
  useContext,
} from 'solid-js';
import { createStore } from 'solid-js/store';

/**
 * On touch a pane's top bar floats over its full-frame content as islands,
 * like the split header of a standalone view. The pane reserves the bars'
 * measured height as `--mobile-content-inset-top`, so its content scrolls
 * beneath them. A bar nested in a hosted detail (a pull request under Home)
 * stacks below the bars before it in document order.
 */
type TouchTopBarInset = {
  report: (
    id: string,
    element: HTMLElement | undefined,
    height: number
  ) => void;
  offset: (id: string) => number;
};

const TouchTopBarInsetContext = createContext<TouchTopBarInset>();

/** A pane frame's floating top bars, stacked in document order. */
export function createTouchTopBarInset() {
  // Solid deletes a store key set to undefined.
  const [heights, setHeights] = createStore<Record<string, number | undefined>>(
    {}
  );
  // Elements only order the bars; their heights are the reactive part.
  const elements: Record<string, HTMLElement | undefined> = {};
  const height = () =>
    Object.values(heights).reduce<number>(
      (total, next) => total + (next ?? 0),
      0
    );
  const precedes = (id: string, other: string) => {
    const element = elements[id];
    const otherElement = elements[other];
    if (!element || !otherElement || element === otherElement) return false;
    return Boolean(
      element.compareDocumentPosition(otherElement) &
        Node.DOCUMENT_POSITION_PRECEDING
    );
  };
  const value: TouchTopBarInset = {
    report: (id, element, next) => {
      // A bar that leaves removes its entry, so a long-lived pane's registry
      // holds only the bars on screen.
      if (!element) {
        delete elements[id];
        setHeights(id, undefined);
        return;
      }
      elements[id] = element;
      setHeights(id, next);
    },
    offset: (id) =>
      Object.entries(heights).reduce<number>(
        (total, [other, next]) =>
          precedes(id, other) ? total + (next ?? 0) : total,
        0
      ),
  };
  return { height, value };
}

export function TouchTopBarInsetProvider(
  props: ParentProps<{ value: TouchTopBarInset }>
) {
  return (
    <TouchTopBarInsetContext.Provider value={props.value}>
      {props.children}
    </TouchTopBarInsetContext.Provider>
  );
}

/**
 * Reports `bar`'s height while it floats. `floats` is false when no pane
 * reserves it; `offset` is the height of the floating bars above it.
 */
export function useTouchTopBarInset(
  bar: Accessor<HTMLElement | undefined>,
  enabled: Accessor<boolean>
): { floats: Accessor<boolean>; offset: Accessor<number> } {
  const inset = useContext(TouchTopBarInsetContext);
  const floats = () => isTouchDevice() && !!inset && enabled();
  if (!inset) return { floats, offset: () => 0 };
  const id = createUniqueId();
  const size = createElementSize(bar);
  // ResizeObserver output feeds the pane's CSS inset.
  createEffect(() =>
    inset.report(id, bar(), floats() ? (size.height ?? 0) : 0)
  );
  onCleanup(() => inset.report(id, undefined, 0));
  return { floats, offset: () => inset.offset(id) };
}

/** Whether top bars float in this pane; in-flow bars' content resets the inset. */
export function useTouchTopBarsFloat(): Accessor<boolean> {
  const inset = useContext(TouchTopBarInsetContext);
  return () => isTouchDevice() && !!inset;
}

/** The content inset a floating bar needs, or the given fallback. */
export function touchTopBarInsetStyle(
  height: number,
  fallback?: string
): JSX.CSSProperties | undefined {
  if (!isTouchDevice()) return undefined;
  if (height > 0) return { '--mobile-content-inset-top': `${height}px` };
  if (fallback === undefined) return undefined;
  return { '--mobile-content-inset-top': fallback };
}

/** Content dissolves beneath a floating bar; nothing without one. */
export function TouchTopBarFade(props: { height: number }) {
  return (
    <Show when={isTouchDevice() && props.height > 0}>
      <MobileTopEdgeFade />
    </Show>
  );
}

/**
 * The bar's title group: an island on touch, inline on desktop. A lone
 * empty child (an unfilled portal mount, a missing title) hides the island.
 */
export function TopBarTitle(props: ParentProps<{ class?: string }>) {
  return (
    <HeaderIsland
      class={cn(
        'min-w-0 shrink px-1 has-[>:only-child:empty]:hidden',
        props.class
      )}
    >
      {props.children}
    </HeaderIsland>
  );
}

/** A lone leading control, such as Back: an island on touch, inline on desktop. */
export function TopBarIsland(props: ParentProps<{ class?: string }>) {
  return (
    <HeaderIsland class={cn('px-1', props.class)}>
      {props.children}
    </HeaderIsland>
  );
}

/** The bar's trailing actions: an island on touch, inline on desktop. */
export function TopBarActions(props: ParentProps<{ class?: string }>) {
  return (
    <div
      class={cn(
        'ml-auto flex shrink-0 items-center gap-1 touch:gap-2',
        props.class
      )}
    >
      <HeaderIsland class="px-1">{props.children}</HeaderIsland>
    </div>
  );
}
