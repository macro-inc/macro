import {
  type Accessor,
  type JSX,
  createSignal,
  createEffect,
  on,
} from 'solid-js';
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

type ThreadListProps<T extends { id: string }> = {
  data: Accessor<T[]>;
  children: (item: T) => JSX.Element;
  initialScrollTarget?: ThreadListScrollTarget;
  onScrollNearTop?: () => void;
  onScrollNearBottom?: () => void;
  onNavigationReady?: (navigation: ThreadListNavigation) => void;
  shift?: Accessor<boolean>;
};

const NEAR_TOP_THRESHOLD = 800;
const NEAR_BOTTOM_THRESHOLD = 50;

export const DEFAULT_INITIAL_SCROLL_TARGET: ThreadListScrollTarget = {
  tag: 'bottom',
  align: 'end',
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, max));

export function shouldStickToBottomOnDataChange(
  isNearBottom: boolean,
  shift?: Accessor<boolean>
): boolean {
  return isNearBottom && !(shift?.() ?? false);
}

function getTargetAlign(target: ThreadListScrollTarget): ScrollAlignment {
  if (target.align) return target.align;
  switch (target.tag) {
    case 'top':
      return 'start';
    case 'bottom':
      return 'end';
    case 'index':
    case 'id':
      return 'nearest';
  }
}

export function ThreadList<T extends { id: string }>(
  props: ThreadListProps<T>
) {
  const [virtualHandle, setVirtualHandle] = createSignal<VirtualizerHandle>();
  const [isNearBottom, setIsNearBottom] = createSignal(true);
  const [didInitialScroll, setDidInitialScroll] = createSignal(false);

  let scrollRef: HTMLDivElement | undefined;
  let nearTopFired = false;
  let nearBottomFired = false;

  const resolveTargetIndex = (target: ThreadListScrollTarget): number => {
    const items = props.data();
    const maxIndex = items.length - 1;
    if (maxIndex < 0) return -1;

    switch (target.tag) {
      case 'top':
        return 0;
      case 'bottom':
        return maxIndex;
      case 'index':
        return clamp(target.index, 0, maxIndex);
      case 'id': {
        const idx = items.findIndex((item) => item.id === target.id);
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
    const itemCount = props.data().length;
    if (!itemCount) return -1;
    return clamp(handle.findItemIndex(handle.scrollOffset), 0, itemCount - 1);
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
      });
    });
  }

  createEffect(
    on(
      () => props.data().length,
      () => {
        const handle = virtualHandle();
        if (!handle || !didInitialScroll()) return;
        if (shouldStickToBottomOnDataChange(isNearBottom(), props.shift)) {
          requestAnimationFrame(() => {
            scrollToTarget(handle, { tag: 'bottom', align: 'end' });
          });
        }
      }
    )
  );

  const handleScroll = () => {
    const handle = virtualHandle();
    if (!handle) return;

    const distanceFromTop = handle.scrollOffset;
    const distanceFromBottom =
      handle.scrollSize - handle.viewportSize - handle.scrollOffset;

    const nearTop = distanceFromTop <= NEAR_TOP_THRESHOLD;
    const nearBottom = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD;

    setIsNearBottom(nearBottom);

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
        data={props.data()}
        onScroll={handleScroll}
        shift={props.shift?.() ?? false}
      >
        {(item) => props.children(item)}
      </Virtualizer>
    </div>
  );
}
