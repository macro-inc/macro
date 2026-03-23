import { type Accessor, type JSX, createSignal } from 'solid-js';
import { type VirtualizerHandle, Virtualizer } from 'virtua/solid';
import type { ScrollToIndexOpts } from 'virtua/unstable_core';

type ScrollAlignment = ScrollToIndexOpts['align'];

export type ThreadListScrollTarget =
  | { tag: 'top'; align?: ScrollAlignment }
  | { tag: 'bottom'; align?: ScrollAlignment }
  | { tag: 'index'; index: number; align?: ScrollAlignment }
  | { tag: 'id'; id: string; align?: ScrollAlignment };

export function defaultThreadListTargetFromMessage(
  targetMessageId: string | undefined
): ThreadListScrollTarget {
  if (targetMessageId) {
    return {
      tag: 'id',
      id: targetMessageId,
    };
  }
  return DEFAULT_INITIAL_SCROLL_TARGET;
}

export type ThreadListNavigation = {
  scrollTo: (target: ThreadListScrollTarget) => boolean;
  scrollToIndex: (index: number, opts?: { align?: ScrollAlignment }) => boolean;
  scrollByDelta: (delta: number, opts?: { align?: ScrollAlignment }) => boolean;
  scrollToTop: (align?: ScrollAlignment) => boolean;
  scrollToBottom: (align?: ScrollAlignment) => boolean;
  scrollToId: (id: string, opts?: { align?: ScrollAlignment }) => boolean;
  navigatePrevious: () => boolean;
  navigateNext: () => boolean;
  isNearBottom: () => boolean;
};

export type ThreadListScrollState = {
  didInitialScroll: boolean;
  isNearBottom: boolean;
  isScrollingDown: boolean;
  distanceFromTop: number;
  distanceFromBottom: number;
  viewportSize: number;
};

type ThreadListProps = {
  keys: Accessor<string[]>;
  children: (item: { id: string }) => JSX.Element;
  initialScrollTarget?: ThreadListScrollTarget;
  onScrollNearTop?: () => void;
  onScrollNearBottom?: () => void;
  onNavigationReady?: (navigation: ThreadListNavigation) => void;
  onScrollStateChange?: (state: ThreadListScrollState) => void;
  shift?: Accessor<boolean>;
  prepend?: Accessor<boolean>;
};

const NEAR_TOP_THRESHOLD = 800;
const NEAR_BOTTOM_THRESHOLD = 50;
const EXPLICIT_SCROLL_INTENT_WINDOW_MS = 250;
const EXPLICIT_SCROLL_DOWN_TRIGGER_DISTANCE = 64;

type ScrollDirection = 'up' | 'down';
type ExplicitScrollIntent = {
  direction: ScrollDirection;
  at: number;
};

export const DEFAULT_INITIAL_SCROLL_TARGET: ThreadListScrollTarget = {
  tag: 'bottom',
  align: 'end',
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, max));

export function isExplicitScrollDown(
  delta: number,
  intent: ExplicitScrollIntent | undefined,
  now = Date.now()
): boolean {
  if (delta <= 0) return false;
  if (!intent) return false;
  if (intent.direction !== 'down') return false;
  return now - intent.at <= EXPLICIT_SCROLL_INTENT_WINDOW_MS;
}

export function accumulateExplicitScrollDownDistance(
  previousDistance: number,
  delta: number,
  intent: ExplicitScrollIntent | undefined,
  now = Date.now()
): number {
  if (!isExplicitScrollDown(delta, intent, now)) return 0;
  return previousDistance + delta;
}

export function hasExplicitScrollDownGesture(distance: number): boolean {
  return distance >= EXPLICIT_SCROLL_DOWN_TRIGGER_DISTANCE;
}

export function getTargetAlign(
  target: ThreadListScrollTarget
): ScrollAlignment {
  if (target.align) return target.align;
  switch (target.tag) {
    case 'top':
      return 'start';
    case 'bottom':
      return 'end';
    case 'index':
    case 'id':
      return 'center';
  }
}

export function ThreadList(props: ThreadListProps) {
  const [virtualHandle, setVirtualHandle] = createSignal<VirtualizerHandle>();
  const [isNearBottom, setIsNearBottom] = createSignal(true);
  const [didInitialScroll, setDidInitialScroll] = createSignal(false);

  let scrollRef: HTMLDivElement | undefined;
  let nearTopFired = false;
  let nearBottomFired = false;
  let previousScrollOffset: number | undefined;
  let explicitScrollIntent: ExplicitScrollIntent | undefined;
  let explicitScrollDownDistance = 0;
  let previousTouchY: number | undefined;

  const markExplicitScrollIntent = (direction: ScrollDirection) => {
    explicitScrollIntent = {
      direction,
      at: Date.now(),
    };
  };

  const resolveTargetIndex = (target: ThreadListScrollTarget): number => {
    const keys = props.keys();
    const maxIndex = keys.length - 1;
    if (maxIndex < 0) return -1;

    switch (target.tag) {
      case 'top':
        return 0;
      case 'bottom':
        return maxIndex;
      case 'index':
        return clamp(target.index, 0, maxIndex);
      case 'id': {
        const idx = keys.indexOf(target.id);
        return idx === -1 ? -1 : idx;
      }
    }
  };

  const scrollToTarget = (
    handle: VirtualizerHandle,
    target: ThreadListScrollTarget
  ): boolean => {
    const index = resolveTargetIndex(target);
    if (index < 0) return false;
    handle.scrollToIndex(index, { align: getTargetAlign(target) });
    return true;
  };

  const getCurrentIndex = (handle: VirtualizerHandle): number => {
    const itemCount = props.keys().length;
    if (!itemCount) return -1;
    return clamp(handle.findItemIndex(handle.scrollOffset), 0, itemCount - 1);
  };

  const emitScrollState = (
    handle: VirtualizerHandle,
    isScrollingDown: boolean
  ) => {
    if (!props.onScrollStateChange) return;
    const distanceFromTop = handle.scrollOffset;
    const distanceFromBottom =
      handle.scrollSize - handle.viewportSize - handle.scrollOffset;
    props.onScrollStateChange({
      didInitialScroll: didInitialScroll(),
      isNearBottom: distanceFromBottom <= NEAR_BOTTOM_THRESHOLD,
      isScrollingDown,
      distanceFromTop,
      distanceFromBottom,
      viewportSize: handle.viewportSize,
    });
  };

  const createNavigation = (
    handle: VirtualizerHandle
  ): ThreadListNavigation => ({
    scrollTo: (target) => scrollToTarget(handle, target),

    scrollToIndex: (index, opts = {}) =>
      scrollToTarget(handle, { tag: 'index', index, align: opts.align }),

    scrollByDelta: (delta, opts = {}) => {
      const current = getCurrentIndex(handle);
      if (current < 0) return false;
      return scrollToTarget(handle, {
        tag: 'index',
        index: current + delta,
        align: opts.align,
      });
    },

    scrollToTop: (align = 'start') =>
      scrollToTarget(handle, { tag: 'top', align }),

    scrollToBottom: (align = 'end') =>
      scrollToTarget(handle, { tag: 'bottom', align }),

    scrollToId: (id, opts = {}) =>
      scrollToTarget(handle, { tag: 'id', id, align: opts.align }),

    navigatePrevious: () => {
      const current = getCurrentIndex(handle);
      if (current <= 0) return false;
      return scrollToTarget(handle, { tag: 'index', index: current - 1 });
    },

    navigateNext: () => {
      const current = getCurrentIndex(handle);
      if (current < 0) return false;
      return scrollToTarget(handle, { tag: 'index', index: current + 1 });
    },

    isNearBottom,
  });

  function scrollOnMount(handle: VirtualizerHandle) {
    const target = props.initialScrollTarget ?? DEFAULT_INITIAL_SCROLL_TARGET;
    requestAnimationFrame(() => {
      scrollToTarget(handle, target);
      requestAnimationFrame(() => {
        // Run a second pass after layout settles to avoid partial initial anchoring.
        scrollToTarget(handle, target);
        setDidInitialScroll(true);
        emitScrollState(handle, false);
      });
    });
  }

  const handleScroll = () => {
    const handle = virtualHandle();
    if (!handle) return;

    const distanceFromTop = handle.scrollOffset;
    const distanceFromBottom =
      handle.scrollSize - handle.viewportSize - handle.scrollOffset;

    const nearTop = distanceFromTop <= NEAR_TOP_THRESHOLD;
    const nearBottom = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD;

    setIsNearBottom(nearBottom);
    let nextIsScrollingDown = false;

    if (previousScrollOffset !== undefined) {
      const delta = handle.scrollOffset - previousScrollOffset;
      explicitScrollDownDistance = accumulateExplicitScrollDownDistance(
        explicitScrollDownDistance,
        delta,
        explicitScrollIntent
      );
      nextIsScrollingDown = hasExplicitScrollDownGesture(
        explicitScrollDownDistance
      );
    }
    previousScrollOffset = handle.scrollOffset;
    emitScrollState(handle, nextIsScrollingDown);

    if (!didInitialScroll()) return;

    if (nearTop && !nearTopFired) {
      nearTopFired = true;
      props.onScrollNearTop?.();
    } else if (!nearTop) {
      nearTopFired = false;
    }

    if (nearBottom && !nearBottomFired) {
      nearBottomFired = true;
      props.onScrollNearBottom?.();
    } else if (!nearBottom) {
      nearBottomFired = false;
    }
  };

  return (
    <div
      ref={scrollRef}
      onWheel={(event) => {
        if (event.deltaY === 0) return;
        markExplicitScrollIntent(event.deltaY > 0 ? 'down' : 'up');
      }}
      onTouchStart={(event) => {
        previousTouchY = event.touches.item(0)?.clientY;
      }}
      onTouchMove={(event) => {
        const nextTouchY = event.touches.item(0)?.clientY;
        if (nextTouchY === undefined || previousTouchY === undefined) return;

        const deltaY = previousTouchY - nextTouchY;
        if (deltaY !== 0) {
          markExplicitScrollIntent(deltaY > 0 ? 'down' : 'up');
        }
        previousTouchY = nextTouchY;
      }}
      onTouchEnd={() => {
        previousTouchY = undefined;
      }}
      onTouchCancel={() => {
        previousTouchY = undefined;
      }}
      style={{
        width: '100%',
        'overflow-y': 'auto',
        'overflow-anchor': 'none',
        height: '100%',
        display: 'flex',
        'flex-direction': 'column',
      }}
    >
      <Virtualizer
        ref={(ref) => {
          if (!ref) return;
          setVirtualHandle(ref);
          if (props.onNavigationReady) {
            props.onNavigationReady(createNavigation(ref));
          }
          scrollOnMount(ref);
        }}
        scrollRef={scrollRef}
        data={props.keys()}
        onScroll={handleScroll}
        shift={props.shift?.() ?? false}
      >
        {(key) => props.children({ id: key })}
      </Virtualizer>
    </div>
  );
}
