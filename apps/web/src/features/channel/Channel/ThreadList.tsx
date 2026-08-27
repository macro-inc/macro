import { CustomScrollbar } from '@core/component/CustomScrollbar';
import {
  createScrollIntentTracker,
  type ScrollDirection,
} from '@core/util/scroll-intent';
import { type Accessor, createSignal, type JSX, onCleanup } from 'solid-js';
import { Virtualizer, type VirtualizerHandle } from 'virtua/solid';
import type { CacheSnapshot, ScrollToIndexOpts } from 'virtua/unstable_core';
import { NEAR_BOTTOM_THRESHOLD } from './constants';

const BASE_ITEM_SIZE = 96;
const BASE_BUFFER_SIZE = 500;

type ScrollAlignment = ScrollToIndexOpts['align'];

export type ThreadListScrollTarget =
  | { tag: 'top'; align?: ScrollAlignment }
  | { tag: 'bottom'; align?: ScrollAlignment }
  | { tag: 'index'; index: number; align?: ScrollAlignment }
  | { tag: 'id'; id: string; align?: ScrollAlignment };

type InitialScrollTarget =
  | ThreadListScrollTarget
  | { tag: 'offset'; scrollOffset: number };

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
  /** Position a descendant using Virtua's measured coordinate space. */
  scrollToElementInItem: (
    id: string,
    itemElement: HTMLElement,
    targetElement: HTMLElement
  ) => boolean;
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

export type ThreadListScrollSnapshot = {
  scrollOffset: number;
  virtualCache?: CacheSnapshot;
  isNearBottom: boolean;
};

export type FullFrameThreadListScrollInsets = {
  /** Space reserved before the first message (e.g. status bar + floating header). */
  start: number;
  /** Space reserved after the last message (e.g. floating input + dock). */
  end: number;
};

type ThreadListProps = {
  /** Identifies the channel scroll surface when multiple splits are mounted. */
  channelId?: string;
  keys: Accessor<string[]>;
  children: (item: { id: string }) => JSX.Element;
  initialScrollTarget?: ThreadListScrollTarget;
  /** A kept-mounted descendant owns the targeted initial viewport movement. */
  initialScrollHandledByTargetElement?: boolean;
  onScrollNearTop?: () => void;
  onScrollNearBottom?: () => void;
  onNavigationReady?: (navigation: ThreadListNavigation) => void;
  onScrollStateChange?: (state: ThreadListScrollState) => void;
  initialScrollSnapshot?: ThreadListScrollSnapshot;
  onScrollSnapshotChange?: (snapshot: ThreadListScrollSnapshot) => void;
  shift?: Accessor<boolean>;
  prepend?: Accessor<boolean>;
  /** Item indexes that must remain mounted during nested-message navigation. */
  keepMounted?: Accessor<readonly number[]>;
  /**
   * For full-frame insets where the scroll surface spans the whole screen and content
   * scrolls behind the floating chrome. Rendered as scroll-content padding and fed to
   * virtua via `startMargin` + per-align scroll offsets.
   */
  fullFrameScrollInsets?: Accessor<FullFrameThreadListScrollInsets>;
};

const NEAR_TOP_THRESHOLD = 800;
const EXPLICIT_SCROLL_DOWN_TRIGGER_DISTANCE = 64;

// After an imperative scroll-to-bottom, hold the viewport at the true bottom for
// this long. virtua targets a scroll offset from its cached item sizes and stops
// correcting ~150ms after the last measurement, and the scroller runs with
// `overflow-anchor: none`, so a last message that grows afterwards (a loading
// image or video, a new reaction, an opening reply input) is left cut off. The
// re-pin window absorbs that late growth so a single action lands fully down.
const SCROLL_TO_BOTTOM_SETTLE_MS = 1000;

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
  let cancelPinToBottom: (() => void) | undefined;

  const scrollIntent = createScrollIntentTracker();

  let initialScrollStarted = false;
  let initialScrollRetried = false;
  let initialScrollTarget: InitialScrollTarget = DEFAULT_INITIAL_SCROLL_TARGET;

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
    target: ThreadListScrollTarget,
    options: { cancelPin?: boolean } = {}
  ): boolean => {
    const index = resolveTargetIndex(target);
    if (index < 0) return false;
    // A deliberate navigation to a specific target aborts an in-flight
    // pinToBottom settle loop, which would otherwise yank the view back to the
    // bottom frame-by-frame and strand the target (e.g. opening a channel at
    // latest, then clicking a message/thread row within its settle window).
    // pinToBottom opts out so it doesn't cancel the loop it is establishing.
    if (options.cancelPin !== false) cancelPinToBottom?.();
    const align = getTargetAlign(target);
    handle.scrollToIndex(index, { align, offset: insetAlignOffset(align) });
    return true;
  };

  const scrollToInitialTarget = (
    handle: VirtualizerHandle,
    target: InitialScrollTarget
  ): boolean => {
    if (target.tag !== 'offset') return scrollToTarget(handle, target);

    handle.scrollTo(target.scrollOffset);
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
    target: InitialScrollTarget
  ): boolean => {
    switch (target.tag) {
      case 'offset':
        return Math.abs(handle.scrollOffset - target.scrollOffset) <= 1;
      case 'bottom':
        return getDistanceFromBottom(handle) <= NEAR_BOTTOM_THRESHOLD;
      case 'top':
        return handle.scrollOffset <= NEAR_BOTTOM_THRESHOLD;
      case 'id':
      case 'index': {
        const targetIndex = resolveTargetIndex(target);
        if (targetIndex < 0) return true; // target gone, nothing to verify
        // Correct when the target item intersects the usable viewport.
        // Comparing item indexes against the top-of-viewport item breaks for
        // center/end alignment — a target near the end of the list rests in
        // the lower half of the viewport, so a fixed index distance from the
        // top item reports a perfect landing as a miss.
        const itemTop = handle.getItemOffset(targetIndex);
        const itemBottom = itemTop + handle.getItemSize(targetIndex);
        const viewportTop = handle.scrollOffset + insets().start;
        const viewportBottom =
          handle.scrollOffset + handle.viewportSize - insets().end;
        return itemBottom > viewportTop && itemTop < viewportBottom;
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
    emitScrollSnapshot(handle);
  };

  const emitScrollSnapshot = (handle: VirtualizerHandle) => {
    props.onScrollSnapshotChange?.({
      scrollOffset: handle.scrollOffset,
      virtualCache: handle.cache,
      isNearBottom: getDistanceFromBottom(handle) <= NEAR_BOTTOM_THRESHOLD,
    });
  };

  // Scroll to the newest message, then keep re-pinning to the true bottom for a
  // short window so late-settling content can't leave the last message cut off.
  // Aborts on a real scroll gesture (wheel up or touch drag), not on taps.
  const pinToBottom = (handle: VirtualizerHandle): boolean => {
    cancelPinToBottom?.();

    const didScroll = scrollToTarget(
      handle,
      { tag: 'bottom', align: 'end' },
      { cancelPin: false }
    );
    const el = scrollRef;
    if (!didScroll || !el) return didScroll;

    let rafId = 0;
    const start = performance.now();
    const virtualContent = Array.from(el.children).find(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && child.style.contain.includes('size')
    );
    const resizeObserver = virtualContent
      ? new ResizeObserver(() => {
          if (getDistanceFromBottom(handle) > 1) el.scrollTop = el.scrollHeight;
        })
      : undefined;
    if (virtualContent) resizeObserver?.observe(virtualContent);

    const stop = () => {
      if (rafId) cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onPointerDown);
      if (cancelPinToBottom === stop) cancelPinToBottom = undefined;
    };

    function onWheel(event: WheelEvent) {
      if (event.deltaY < 0) stop();
    }

    // A press on a message, reply button, or reaction is not a scroll and must
    // not cancel pinning. Only a wheel-up or a touch drag is the user scrolling.
    function onPointerDown(event: PointerEvent) {
      if (event.pointerType === 'touch') stop();
    }

    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('pointerdown', onPointerDown, { passive: true });
    cancelPinToBottom = stop;

    const tick = () => {
      if (getDistanceFromBottom(handle) > 1) el.scrollTop = el.scrollHeight;
      if (performance.now() - start >= SCROLL_TO_BOTTOM_SETTLE_MS) {
        stop();
        return;
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return true;
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

    scrollToBottom: () => pinToBottom(handle),

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

    scrollToElementInItem: (id, itemElement, targetElement) => {
      const index = props.keys().indexOf(id);
      if (index === -1) return false;

      cancelPinToBottom?.();
      const itemRect = itemElement.getBoundingClientRect();
      const targetRect = targetElement.getBoundingClientRect();
      const targetCenter =
        handle.getItemOffset(index) +
        (targetRect.top - itemRect.top) +
        targetRect.height / 2;
      const { start, end } = insets();
      const usableViewportCenter =
        start + (handle.viewportSize - start - end) / 2;
      // The DOM scroll range includes the full-frame inset spacers; Virtua's
      // scrollSize only covers its own items.
      const maxScrollOffset = scrollRef
        ? scrollRef.scrollHeight - scrollRef.clientHeight
        : handle.scrollSize - handle.viewportSize;
      handle.scrollTo(
        clamp(
          targetCenter - usableViewportCenter,
          0,
          Math.max(0, maxScrollOffset)
        )
      );
      return true;
    },

    markUserIntent: scrollIntent.markUserIntent,
  });

  function beginInitialTargetScroll(
    handle: VirtualizerHandle,
    target: InitialScrollTarget
  ) {
    initialScrollTarget = target;

    console.debug('ThreadList: scrollOnMount', {
      target,
      itemCount: props.keys().length,
      scrollOffset: handle.scrollOffset,
      scrollSize: handle.scrollSize,
      viewportSize: handle.viewportSize,
    });

    const didScroll =
      target.tag === 'bottom'
        ? pinToBottom(handle)
        : scrollToInitialTarget(handle, target);

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

  let disposed = false;

  // A preview-pane mount can hand over the virtualizer before layout, with a
  // zero-height viewport — the initial scroll then lands wherever and always
  // needs the onScrollEnd retry. Wait (bounded) for a measured viewport.
  function scrollOnMountWhenMeasured(
    handle: VirtualizerHandle,
    framesLeft = 30
  ) {
    if (disposed || initialScrollStarted) return;
    if (handle.viewportSize > 0 || framesLeft <= 0) {
      scrollOnMount(handle);
      return;
    }
    requestAnimationFrame(() =>
      scrollOnMountWhenMeasured(handle, framesLeft - 1)
    );
  }

  const getInitialScrollTarget = (): InitialScrollTarget => {
    const snapshot = props.initialScrollSnapshot;
    if (snapshot) {
      return snapshot.isNearBottom
        ? DEFAULT_INITIAL_SCROLL_TARGET
        : { tag: 'offset', scrollOffset: snapshot.scrollOffset };
    }

    return props.initialScrollTarget ?? DEFAULT_INITIAL_SCROLL_TARGET;
  };

  // Virtua publishes its handle before ResizeObserver has populated
  // `viewportSize`. Waiting for that measurement before doing anything leaves
  // an overflowing channel visibly parked at scrollTop=0 for one or more
  // frames. A bottom target is safe to issue immediately: with a zero viewport
  // Virtua overshoots the final offset and the browser clamps it to the DOM's
  // current maximum, putting the first painted frame at the bottom. The normal
  // measured pass below still corrects the exact end alignment afterwards.
  const prepositionInitialBottom = (handle: VirtualizerHandle) => {
    const target = getInitialScrollTarget();
    if (target.tag === 'bottom') pinToBottom(handle);
  };

  function scrollOnMount(handle: VirtualizerHandle) {
    if (initialScrollStarted) return;
    initialScrollStarted = true;
    if (props.initialScrollHandledByTargetElement) {
      completeInitialScroll(handle);
      return;
    }
    beginInitialTargetScroll(handle, getInitialScrollTarget());
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
        const offsetBeforeRetry = handle.scrollOffset;
        const retryScrolled =
          initialScrollTarget.tag === 'bottom'
            ? pinToBottom(handle)
            : scrollToInitialTarget(handle, initialScrollTarget);
        if (!retryScrolled) {
          // Target disappeared between mount and retry — finalize now since
          // no scroll events will fire to trigger another onScrollEnd.
          completeInitialScroll(handle);
          return;
        }
        // A retry that lands on the current position moves nothing, so no
        // scroll events (and no onScrollEnd) follow. Finalize on the next
        // frame or `didInitialScroll` stays false for the life of the mount,
        // deadlocking everything gated on it (target navigation, scroll
        // pagination, goToLatest).
        requestAnimationFrame(() => {
          if (didInitialScroll()) return;
          if (handle.scrollOffset !== offsetBeforeRetry) return;
          console.debug(
            'ThreadList: retry did not move the scroll, completing'
          );
          completeInitialScroll(handle);
        });
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
    emitScrollSnapshot(handle);

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

  onCleanup(() => {
    disposed = true;
    cancelPinToBottom?.();
  });

  return (
    <>
      <div
        ref={(el) => {
          scrollRef = el;
          setScrollEl(el);
        }}
        data-channel-scroll
        data-channel-id={props.channelId}
        data-channel-scroll-inset-start={insets().start}
        data-channel-scroll-inset-end={insets().end}
        class="scrollbar-hidden px-2"
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
          cache={props.initialScrollSnapshot?.virtualCache}
          ref={(ref) => {
            if (!ref) return;
            setVirtualHandle(ref);
            if (props.onNavigationReady) {
              props.onNavigationReady(createNavigation(ref));
            }
            resetInitialScroll();
            prepositionInitialBottom(ref);
            scrollOnMountWhenMeasured(ref);
          }}
          scrollRef={scrollRef}
          startMargin={insets().start}
          itemSize={BASE_ITEM_SIZE}
          bufferSize={BASE_BUFFER_SIZE}
          keepMounted={props.keepMounted?.()}
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
