import { CustomScrollbar } from '@core/component/CustomScrollbar';
import {
  createScrollIntentTracker,
  type ScrollDirection,
} from '@core/util/scroll-intent';
import { Key } from '@solid-primitives/keyed';
import {
  createVirtualizer,
  defaultRangeExtractor,
  elementScroll,
  measureElement,
  observeElementOffset,
  observeElementRect,
  type Range,
  type ScrollToOptions,
  type VirtualItem,
} from '@tanstack/solid-virtual';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  type JSX,
  on,
  onCleanup,
  onMount,
} from 'solid-js';
import { NEAR_BOTTOM_THRESHOLD } from './constants';
import { createScrollLifecycle } from './create-scroll-lifecycle';

type ScrollAlignment = NonNullable<ScrollToOptions['align']>;

const BASE_ITEM_SIZE = 96;
const OVERSCAN = 6;

export type ThreadListInitialPosition =
  | { type: 'latest' }
  | { type: 'element'; id: string }
  | { type: 'restore'; snapshot: ThreadListScrollSnapshot };

export type ThreadListNavigation = {
  scrollToLatest: () => boolean;
  scrollToMessage: (
    id: string,
    options?: { align?: ScrollAlignment; userIntent?: ScrollDirection }
  ) => boolean;
  /** Center a mounted message or reply inside the unobscured viewport. */
  scrollToElement: (element: HTMLElement) => boolean;
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
  measurements?: VirtualItem[];
  isNearBottom: boolean;
};

type ScrollInsets = {
  /** Space reserved before the first message (e.g. status bar + floating header). */
  start: number;
  /** Space reserved after the last message (e.g. floating input + dock). */
  end: number;
};

type ThreadListProps = {
  keys: Accessor<string[]>;
  children: (item: { id: string }) => JSX.Element;
  initialPosition?: ThreadListInitialPosition;
  onScrollNearTop?: () => void;
  onScrollNearBottom?: () => void;
  /** Physical gestures and keyboard navigation supersede pending page jumps. */
  onUserNavigation?: () => void;
  /** Called after initial layout; its optional cleanup releases the handle. */
  onReady?: (navigation: ThreadListNavigation) => void | (() => void);
  /** State and snapshot describe the same committed position. */
  onScroll?: (
    state: ThreadListScrollState,
    snapshot: ThreadListScrollSnapshot | undefined
  ) => void;
  /** Follow live messages only when the loaded window includes the latest page. */
  followOnAppend?: boolean;
  /** Keep this thread mounted while its message or reply is being positioned. */
  targetId?: string;
  /**
   * For full-frame insets where the scroll surface spans the whole screen and content
   * scrolls behind the floating chrome. Included in virtual measurements and navigation.
   */
  insets?: ScrollInsets;
};

const NEAR_TOP_THRESHOLD = 800;
const EXPLICIT_SCROLL_DOWN_TRIGGER_DISTANCE = 64;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, max));

const NO_SCROLL_INSETS: ScrollInsets = { start: 0, end: 0 };

export function ThreadList(props: ThreadListProps) {
  // Publish the ref on mount: Solid template nodes can still belong to an
  // inert document (no defaultView) when the ref callback runs.
  let scrollRef: HTMLDivElement | undefined;
  let contentRef: HTMLDivElement | undefined;
  const [scrollEl, setScrollEl] = createSignal<HTMLDivElement>();
  const [viewportSize, setViewportSize] = createSignal(0);
  const insets = () => props.insets ?? NO_SCROLL_INSETS;
  // Capture each key array so the previous virtualizer options still describe
  // the previous page while TanStack resolves its prepend anchor.
  const getItemKey = createMemo(() => {
    const keys = [...props.keys()];
    return (index: number) => keys[index];
  });
  const scrollIntent = createScrollIntentTracker(() => {
    lifecycle.send('user-scroll');
    props.onUserNavigation?.();
  });
  const initialPosition = props.initialPosition ?? { type: 'latest' };
  const snapshot =
    initialPosition.type === 'restore' ? initialPosition.snapshot : undefined;
  // Seed the first range with cached sizes too: tall saved rows can put the
  // actual end far beyond the default estimate, before any DOM is measured.
  const initialSizes = new Map(
    snapshot?.measurements?.map(({ key, size }) => [key, size])
  );
  let programmaticOffset: number | undefined;
  let userScrollActive = false;
  let stateQueued = false;
  let nearTopFired = false;
  let nearBottomFired = false;
  let previousScrollOffset = snapshot?.scrollOffset ?? 0;
  let explicitScrollDownDistance = 0;
  let releaseNavigation: void | (() => void);

  // Publish after Solid has committed the virtual rows and spacer height.
  // Geometry notifications also cover reactions, streamed content and resizes
  // that do not produce a browser scroll event.
  const scheduleScrollState = () => {
    if (stateQueued) return;
    stateQueued = true;
    queueMicrotask(() => {
      stateQueued = false;
      if (!lifecycle.isDisposed()) emitScrollState();
    });
  };

  const lifecycle = createScrollLifecycle({
    hasLayout: () => viewportSize() > 0 && props.keys().length > 0,
    waitForElement: initialPosition.type === 'element',
    positionInitial: () => {
      // Restored history has already been positioned by initialOffset. Replaying
      // its offset here would undo corrections for rows measured during mount.
      if (!snapshot || snapshot.isNearBottom) {
        virtualizer.scrollToEnd();
      }
    },
    positionFallback: () => {
      if (
        initialPosition.type === 'element' &&
        !scrollToMessage(initialPosition.id)
      ) {
        virtualizer.scrollToEnd();
      }
    },
    onReady: () => {
      releaseNavigation = props.onReady?.(navigation);
    },
  });

  const virtualizer = createVirtualizer<HTMLDivElement, HTMLDivElement>({
    // Do not consume initialOffset against an empty query result. Enabling
    // with the first page lets TanStack render the latest rows immediately.
    get enabled() {
      return props.keys().length > 0;
    },
    get count() {
      return props.keys().length;
    },
    getScrollElement: () => scrollEl() ?? null,
    get getItemKey() {
      return getItemKey();
    },
    estimateSize: () => BASE_ITEM_SIZE,
    overscan: OVERSCAN,
    // A restored snapshot or a newly remounted message can have a different
    // height. The default sync path returns cached sizes, exposing the old
    // layout until ResizeObserver fires. Read mounted rows before first paint.
    measureElement: (element, entry, instance) =>
      entry ? measureElement(element, entry, instance) : element.offsetHeight,
    // Measure outside ResizeObserver delivery: committing row/sizer geometry
    // inside its callback can leave undelivered notifications in WebKit.
    useAnimationFrameWithResizeObserver: true,
    useScrollendEvent: true,
    anchorTo: 'end',
    get followOnAppend() {
      return lifecycle.isReady() && (props.followOnAppend ?? true);
    },
    scrollEndThreshold: NEAR_BOTTOM_THRESHOLD,
    get paddingStart() {
      return insets().start;
    },
    get paddingEnd() {
      return insets().end;
    },
    get scrollPaddingStart() {
      return insets().start;
    },
    get scrollPaddingEnd() {
      return insets().end;
    },
    initialMeasurementsCache: snapshot?.measurements,
    initialOffset: () =>
      snapshot && !snapshot.isNearBottom
        ? snapshot.scrollOffset
        : initialPosition.type === 'latest' || (snapshot?.isNearBottom ?? false)
          ? props
              .keys()
              .reduce(
                (total, key) =>
                  total + (initialSizes.get(key) ?? BASE_ITEM_SIZE),
                insets().start + insets().end
              )
          : 0,
    get rangeExtractor() {
      const index =
        props.targetId === undefined
          ? -1
          : props.keys().indexOf(props.targetId);
      return (range: Range) => {
        const indexes = defaultRangeExtractor(range);
        if (index < 0 || index >= range.count || indexes.includes(index))
          return indexes;
        return [...indexes, index].sort((a, b) => a - b);
      };
    },
    scrollToFn: (offset, options, instance) => {
      // Size corrections happen before the Solid adapter publishes its new
      // total. Commit the sizer first so the browser cannot clamp the requested
      // scroll to the old range (especially with padding below a growing row).
      if (contentRef) {
        contentRef.style.height = `${Math.max(viewportSize(), instance.getTotalSize())}px`;
      }
      // A deferred prepend has already advanced the logical offset while
      // the DOM is still at the old position. Positive corrections in that
      // state must start at the DOM offset; normal corrections (including
      // shrink clamping) still use TanStack's requested offset.
      const domOffset = instance.scrollElement?.scrollTop ?? offset;
      const deferredPrepend =
        (options.adjustments ?? 0) > 0 &&
        offset > domOffset + 1.5 &&
        (userScrollActive || scrollIntent.isUserInteracting());
      elementScroll(deferredPrepend ? domOffset : offset, options, instance);
      programmaticOffset =
        options.behavior === 'smooth'
          ? undefined
          : instance.scrollElement?.scrollTop;
    },
    observeElementOffset: (instance, callback) =>
      observeElementOffset(instance, (offset, isScrolling) => {
        // An instant navigation/correction is not touch momentum. Reporting
        // its scroll event as momentum makes iOS defer size compensation and
        // replay it after scrollToIndex has already reconciled the same sizes.
        const isOwnScroll =
          programmaticOffset !== undefined &&
          Math.abs(offset - programmaticOffset) < 1.5;
        programmaticOffset = undefined;
        if (isScrolling && !isOwnScroll) userScrollActive = true;
        callback(offset, isScrolling && !isOwnScroll);
        // Keep the gesture active while the end callback flushes any deferred
        // correction, including momentum lasting past the input-event timeout.
        if (!isScrolling || isOwnScroll) userScrollActive = false;
      }),
    observeElementRect: (instance, callback) =>
      observeElementRect(instance, (rect) => {
        const previousHeight = instance.scrollRect?.height ?? 0;
        const wasAtEnd =
          instance.getTotalSize() -
            previousHeight -
            (instance.scrollOffset ?? 0) <=
          NEAR_BOTTOM_THRESHOLD;
        callback(rect);
        setViewportSize(rect.height);
        scheduleScrollState();
        // The core anchors item resizes; viewport resizes (composer, keyboard,
        // split pane) need an explicit end scroll when previously pinned.
        if (previousHeight > 0 && previousHeight !== rect.height && wasAtEnd) {
          instance.scrollToEnd();
        }
      }),
    onChange: scheduleScrollState,
  });

  const shortListOffset = () =>
    Math.max(0, viewportSize() - virtualizer.getTotalSize());
  // The adapter mutates its store by index. Snapshot those values and let Key
  // own each row's accessor by message ID, including while a row is removed.
  // A lookup into a shared map can disappear before queued row effects run.
  const virtualItems = createMemo(() =>
    virtualizer.getVirtualItems().map((item) => ({ ...item }))
  );

  const scrollToMessage = (
    id: string,
    align: ScrollAlignment = 'center'
  ): boolean => {
    const index = props.keys().indexOf(id);
    if (index < 0) return false;
    virtualizer.scrollToIndex(index, { align });
    scheduleScrollState();
    return true;
  };

  const canNavigate = () =>
    lifecycle.isReady() &&
    scrollEl()?.isConnected &&
    (scrollEl()?.clientHeight ?? 0) > 0;

  const navigation: ThreadListNavigation = {
    scrollToLatest: () => {
      if (!canNavigate() || !props.keys().length) return false;
      lifecycle.send('navigate');
      virtualizer.scrollToEnd();
      scheduleScrollState();
      return true;
    },
    scrollToMessage: (id, options) => {
      if (!canNavigate() || !props.keys().includes(id)) return false;
      lifecycle.send('navigate');
      if (options?.userIntent) scrollIntent.markUserIntent(options.userIntent);
      return scrollToMessage(id, options?.align);
    },
    scrollToElement: (targetElement) => {
      const el = scrollEl();
      if (!canNavigate() || !el || !el.contains(targetElement)) return false;
      lifecycle.send('navigate');
      // Both rects come from the same committed layout, including short-list
      // bottom alignment and floating chrome. No stale estimate is involved.
      const targetRect = targetElement.getBoundingClientRect();
      const scrollRect = el.getBoundingClientRect();
      const { start, end } = insets();
      const targetCenter =
        el.scrollTop + targetRect.top - scrollRect.top + targetRect.height / 2;
      virtualizer.scrollToOffset(
        clamp(
          targetCenter - (start + (el.clientHeight - start - end) / 2),
          0,
          Math.max(0, el.scrollHeight - el.clientHeight)
        )
      );
      scheduleScrollState();
      return true;
    },
  };

  function emitScrollState() {
    const el = scrollEl();
    if (!el) return;
    // This microtask runs after synchronous row measurements, before paint.
    lifecycle.send('layout');
    const distanceFromTop = el.scrollTop;
    const distanceFromBottom = virtualizer.getDistanceFromEnd();
    const nearTop = distanceFromTop <= NEAR_TOP_THRESHOLD;
    const nearBottom = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD;
    const hasUserIntent = scrollIntent.isUserInteracting();
    const delta = distanceFromTop - previousScrollOffset;
    if (delta !== 0) {
      explicitScrollDownDistance =
        hasUserIntent && delta > 0 && scrollIntent.lastDirection() === 'down'
          ? explicitScrollDownDistance + delta
          : 0;
    }
    previousScrollOffset = distanceFromTop;
    const state: ThreadListScrollState = {
      didInitialScroll: lifecycle.isReady(),
      isNearBottom: nearBottom,
      isScrollingDown:
        explicitScrollDownDistance >= EXPLICIT_SCROLL_DOWN_TRIGGER_DISTANCE,
      distanceFromTop,
      distanceFromBottom,
      viewportSize: el.clientHeight,
    };
    // Capture both before invoking callers, which may synchronously navigate.
    const snapshot = state.didInitialScroll
      ? {
          scrollOffset: distanceFromTop,
          measurements: virtualizer.takeSnapshot(),
          isNearBottom: nearBottom,
        }
      : undefined;
    props.onScroll?.(state, snapshot);
    if (!lifecycle.isReady()) return;
    if (nearTop && !nearTopFired && hasUserIntent) {
      nearTopFired = true;
      props.onScrollNearTop?.();
    } else if (!nearTop) nearTopFired = false;
    if (nearBottom && !nearBottomFired && hasUserIntent) {
      nearBottomFired = true;
      props.onScrollNearBottom?.();
    } else if (!nearBottom) nearBottomFired = false;
  }

  // Floating chrome can resize without resizing the scroll viewport. Compare
  // against the old content extent before following the new inset to latest.
  createEffect(
    on(insets, (current, previous) => {
      if (!previous || !lifecycle.isReady()) return;
      const delta = current.start + current.end - previous.start - previous.end;
      const previousDistance =
        virtualizer.getTotalSize() -
        delta -
        viewportSize() -
        (virtualizer.scrollOffset ?? 0);
      if (delta !== 0 && previousDistance <= NEAR_BOTTOM_THRESHOLD) {
        virtualizer.scrollToEnd();
      }
      scheduleScrollState();
    })
  );

  onMount(() => {
    // Suspense can construct a channel in an inert template document and
    // insert it in a later task. Bind only after adoption into the live DOM.
    const attachmentObserver = new MutationObserver(connect);
    function connect() {
      if (!scrollRef?.isConnected) return;
      attachmentObserver.disconnect();
      setScrollEl(scrollRef);
      scheduleScrollState();
    }
    attachmentObserver.observe(document, { childList: true, subtree: true });
    connect();
    onCleanup(() => attachmentObserver.disconnect());
  });
  onCleanup(() => {
    lifecycle.send('dispose');
    releaseNavigation?.();
  });

  return (
    <>
      <div
        ref={scrollRef}
        data-channel-scroll
        class="scrollbar-hidden px-2"
        {...scrollIntent.handlers}
        onScroll={scheduleScrollState}
        style={{
          width: '100%',
          height: '100%',
          'overflow-y': 'auto',
          'overflow-anchor': 'none',
        }}
      >
        <div
          ref={contentRef}
          style={{
            position: 'relative',
            width: '100%',
            height: `${Math.max(viewportSize(), virtualizer.getTotalSize())}px`,
          }}
        >
          <Key each={virtualItems()} by="key">
            {(item) => {
              const id = String(item().key);
              let row: HTMLDivElement | undefined;
              createEffect(
                on(
                  () => item().index,
                  () => {
                    if (row) virtualizer.measureElement(row);
                  }
                )
              );
              return (
                <div
                  ref={row}
                  data-index={item().index}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${item().start + shortListOffset()}px)`,
                    'overflow-anchor': 'none',
                  }}
                >
                  {props.children({ id })}
                </div>
              );
            }}
          </Key>
        </div>
      </div>
      <CustomScrollbar scrollContainer={scrollEl} />
    </>
  );
}
