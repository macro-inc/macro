import { CustomScrollbar } from '@core/component/CustomScrollbar';
import {
  createScrollIntentTracker,
  type ScrollDirection,
} from '@core/util/scroll-intent';
import { type Accessor, createSignal, type JSX } from 'solid-js';
import { Virtualizer, type VirtualizerHandle } from 'virtua/solid';
import type { ScrollToIndexOpts } from 'virtua/unstable_core';
import { NEAR_BOTTOM_THRESHOLD } from './constants';

const BASE_ITEM_SIZE: number = 64;
const BASE_BUFFER_SIZE: number = BASE_ITEM_SIZE;

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
  /**
   * Signal that a user-initiated navigation is about to cause a
   * programmatic scroll. Call this before `scrollToId` etc. from
   * hotkey handlers so the resulting scroll is treated as user-driven
   * for pagination purposes.
   */
  markUserIntent: (direction: ScrollDirection) => void;
};

export type ThreadListScrollState = {
  didInitialScroll: boolean;
  isNearBottom: boolean;
  isScrollingDown: boolean;
  distanceFromTop: number;
  distanceFromBottom: number;
  viewportSize: number;
};

export type FullFrameThreadListScrollInsets = {
  /** Space reserved before the first message (e.g. status bar + floating header). */
  start: number;
  /** Space reserved after the last message (e.g. floating input + dock). */
  end: number;
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
  /**
   * For full-frame insets where the scroll surface spans the whole screen and content
   * scrolls behind the floating chrome. Rendered as scroll-content padding and fed to
   * virtua via `startMargin` + per-align scroll offsets.
   */
  fullFrameScrollInsets?: Accessor<FullFrameThreadListScrollInsets>;
};

const NEAR_TOP_THRESHOLD = 800;
const EXPLICIT_SCROLL_DOWN_TRIGGER_DISTANCE = 64;

export const DEFAULT_INITIAL_SCROLL_TARGET: ThreadListScrollTarget = {
  tag: 'bottom',
  align: 'end',
};

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, max));

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

const NO_SCROLL_INSETS: FullFrameThreadListScrollInsets = { start: 0, end: 0 };

export function ThreadList(props: ThreadListProps) {
  const [virtualHandle, setVirtualHandle] = createSignal<VirtualizerHandle>();
  const [isNearBottom, setIsNearBottom] = createSignal(true);
  const [didInitialScroll, setDidInitialScroll] = createSignal(false);
  const [scrollEl, setScrollEl] = createSignal<HTMLDivElement>();

  const insets = () => props.fullFrameScrollInsets?.() ?? NO_SCROLL_INSETS;

  /**
   * Correction so alignment targets the inset-adjusted usable viewport
   * (below the floating header, above the floating bottom chrome) instead
   * of the physical scroll viewport. Derived against virtua's scrollToIndex
   * math with `startMargin = insets().start`.
   */
  const insetAlignOffset = (align: ScrollAlignment): number => {
    const { start, end } = insets();
    switch (align) {
      case 'start':
        return -start;
      case 'end':
        return end;
      case 'center':
        return (end - start) / 2;
      default:
        return 0;
    }
  };

  let scrollRef: HTMLDivElement | undefined;
  let nearTopFired = false;
  let nearBottomFired = false;
  let previousScrollOffset: number | undefined;
  let explicitScrollDownDistance = 0;

  const scrollIntent = createScrollIntentTracker();

  let initialScrollStarted = false;
  let initialScrollRetried = false;
  let initialScrollTarget: ThreadListScrollTarget =
    DEFAULT_INITIAL_SCROLL_TARGET;

  const resetInitialScroll = () => {
    initialScrollStarted = false;
    initialScrollRetried = false;
    initialScrollTarget = DEFAULT_INITIAL_SCROLL_TARGET;
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
    const align = getTargetAlign(target);
    handle.scrollToIndex(index, { align, offset: insetAlignOffset(align) });
    return true;
  };

  // DOM-based so the scroll insets are accounted for — virtua's scrollSize
  // only covers its own items, not the inset padding around them.
  const getDistanceFromBottom = (handle: VirtualizerHandle): number => {
    if (scrollRef) {
      return Math.max(
        0,
        scrollRef.scrollHeight - scrollRef.clientHeight - scrollRef.scrollTop
      );
    }
    return handle.scrollSize - handle.viewportSize - handle.scrollOffset;
  };

  const isScrollPositionCorrect = (
    handle: VirtualizerHandle,
    target: ThreadListScrollTarget
  ): boolean => {
    switch (target.tag) {
      case 'bottom':
        return getDistanceFromBottom(handle) <= NEAR_BOTTOM_THRESHOLD;
      case 'top':
        return handle.scrollOffset <= NEAR_BOTTOM_THRESHOLD;
      case 'id':
      case 'index': {
        const targetIndex = resolveTargetIndex(target);
        if (targetIndex < 0) return true; // target gone, nothing to verify
        const currentIndex = handle.findItemIndex(
          handle.scrollOffset + insets().start
        );
        // Consider correct if the target is within a reasonable range of
        // the current viewport (within ±5 items accounts for alignment).
        return Math.abs(currentIndex - targetIndex) <= 5;
      }
    }
  };

  const getCurrentIndex = (handle: VirtualizerHandle): number => {
    const itemCount = props.keys().length;
    if (!itemCount) return -1;
    return clamp(
      handle.findItemIndex(handle.scrollOffset + insets().start),
      0,
      itemCount - 1
    );
  };

  const emitScrollState = (
    handle: VirtualizerHandle,
    isScrollingDown: boolean
  ) => {
    if (!props.onScrollStateChange) return;
    const distanceFromTop = handle.scrollOffset;
    const distanceFromBottom = getDistanceFromBottom(handle);
    props.onScrollStateChange({
      didInitialScroll: didInitialScroll(),
      isNearBottom: distanceFromBottom <= NEAR_BOTTOM_THRESHOLD,
      isScrollingDown,
      distanceFromTop,
      distanceFromBottom,
      viewportSize: handle.viewportSize,
    });
  };

  /** Mark the initial scroll as complete and broadcast the scroll state. */
  const completeInitialScroll = (handle: VirtualizerHandle) => {
    setDidInitialScroll(true);
    emitScrollState(handle, false);
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

    markUserIntent: scrollIntent.markUserIntent,
  });

  function scrollOnMount(handle: VirtualizerHandle) {
    if (initialScrollStarted) return;
    initialScrollStarted = true;

    const target = props.initialScrollTarget ?? DEFAULT_INITIAL_SCROLL_TARGET;
    initialScrollTarget = target;

    console.debug('ThreadList: scrollOnMount', {
      target,
      itemCount: props.keys().length,
      scrollOffset: handle.scrollOffset,
      scrollSize: handle.scrollSize,
      viewportSize: handle.viewportSize,
    });

    const didScroll = scrollToTarget(handle, target);

    if (!didScroll) {
      // Empty list or target not found — nothing to verify.
      console.debug(
        'ThreadList: target not resolvable, completing immediately'
      );
      completeInitialScroll(handle);
      return;
    }

    // If no actual scrolling was needed (content fits in viewport),
    // onScrollEnd will never fire. Use a RAF to detect this case and
    // finalize immediately.
    requestAnimationFrame(() => {
      if (didInitialScroll()) return;
      if (isScrollPositionCorrect(handle, target)) {
        console.debug(
          'ThreadList: position already correct (RAF fallback), completing'
        );
        completeInitialScroll(handle);
      }
    });
  }

  const handleScrollEnd = () => {
    if (didInitialScroll()) return;

    const handle = virtualHandle();
    if (!handle) return;

    if (isScrollPositionCorrect(handle, initialScrollTarget)) {
      console.debug('ThreadList: onScrollEnd confirmed position, completing', {
        scrollOffset: handle.scrollOffset,
        distanceFromBottom: getDistanceFromBottom(handle),
      });
      completeInitialScroll(handle);
      return;
    }

    if (!initialScrollRetried) {
      initialScrollRetried = true;
      console.debug('ThreadList: initial scroll missed target, retrying', {
        target: initialScrollTarget,
        scrollOffset: handle.scrollOffset,
        scrollSize: handle.scrollSize,
        viewportSize: handle.viewportSize,
        distanceFromBottom: getDistanceFromBottom(handle),
      });
      requestAnimationFrame(() => {
        const retryScrolled = scrollToTarget(handle, initialScrollTarget);
        if (!retryScrolled) {
          // Target disappeared between mount and retry — finalize now since
          // no scroll events will fire to trigger another onScrollEnd.
          completeInitialScroll(handle);
        }
      });
      return;
    }
    console.warn(
      'ThreadList: initial scroll did not reach target after retry',
      {
        target: initialScrollTarget,
        scrollOffset: handle.scrollOffset,
        scrollSize: handle.scrollSize,
        viewportSize: handle.viewportSize,
        distanceFromBottom: getDistanceFromBottom(handle),
      }
    );
    completeInitialScroll(handle);
  };

  const handleScroll = () => {
    const handle = virtualHandle();
    if (!handle) {
      console.warn(
        'Channel.ThreadList: handle scroll but the handle is undefined'
      );
      return;
    }

    const distanceFromTop = handle.scrollOffset;
    const distanceFromBottom = getDistanceFromBottom(handle);

    const nearTop = distanceFromTop <= NEAR_TOP_THRESHOLD;
    const nearBottom = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD;

    setIsNearBottom(nearBottom);
    let nextIsScrollingDown = false;

    if (previousScrollOffset !== undefined) {
      const delta = handle.scrollOffset - previousScrollOffset;
      // Accumulate downward scroll distance only during user interaction
      // and only when the user is scrolling down. Used by the scroll-to-bottom overlay.
      if (
        scrollIntent.isUserInteracting() &&
        delta > 0 &&
        scrollIntent.lastDirection() === 'down'
      ) {
        explicitScrollDownDistance += delta;
      } else {
        explicitScrollDownDistance = 0;
      }
      nextIsScrollingDown =
        explicitScrollDownDistance >= EXPLICIT_SCROLL_DOWN_TRIGGER_DISTANCE;
    }
    previousScrollOffset = handle.scrollOffset;
    emitScrollState(handle, nextIsScrollingDown);

    if (!didInitialScroll()) return;

    // Only trigger pagination callbacks when the user is actively
    // interacting with the scroll surface. This prevents synthetic
    // scroll events from the virtualizer (content resizes, layout
    // reflows, shift adjustments) from incorrectly loading more pages.
    const hasUserIntent = scrollIntent.isUserInteracting();

    if (nearTop && !nearTopFired && hasUserIntent) {
      nearTopFired = true;
      props.onScrollNearTop?.();
    } else if (!nearTop) {
      nearTopFired = false;
    }

    if (nearBottom && !nearBottomFired && hasUserIntent) {
      nearBottomFired = true;
      props.onScrollNearBottom?.();
    } else if (!nearBottom) {
      nearBottomFired = false;
    }
  };

  return (
    <>
      <div
        ref={(el) => {
          scrollRef = el;
          setScrollEl(el);
        }}
        data-channel-scroll
        class="scrollbar-hidden"
        {...scrollIntent.handlers}
        style={{
          width: '100%',
          'overflow-y': 'auto',
          'overflow-anchor': 'none',
          height: '100%',
          display: 'flex',
          'flex-direction': 'column',
        }}
      >
        {/* Spacer div for full-frame inset. */}
        <div
          aria-hidden
          style={{ height: `${insets().start}px`, 'flex-shrink': 0 }}
        />
        <div style="flex-grow: 1" />
        <Virtualizer
          ref={(ref) => {
            if (!ref) return;
            setVirtualHandle(ref);
            if (props.onNavigationReady) {
              props.onNavigationReady(createNavigation(ref));
            }
            resetInitialScroll();
            scrollOnMount(ref);
          }}
          scrollRef={scrollRef}
          startMargin={insets().start}
          itemSize={BASE_ITEM_SIZE}
          bufferSize={BASE_BUFFER_SIZE}
          data={props.keys()}
          onScroll={handleScroll}
          onScrollEnd={handleScrollEnd}
          shift={props.shift?.() ?? false}
        >
          {(key) => props.children({ id: key })}
        </Virtualizer>
        {/* Spacer div for full-frame inset. */}
        <div
          aria-hidden
          style={{ height: `${insets().end}px`, 'flex-shrink': 0 }}
        />
      </div>
      <CustomScrollbar scrollContainer={scrollEl} />
    </>
  );
}
