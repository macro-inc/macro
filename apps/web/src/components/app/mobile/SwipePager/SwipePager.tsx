import { mergeRefs } from '@solid-primitives/refs';
import {
  type Accessor,
  batch,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  type ParentProps,
  splitProps,
} from 'solid-js';
import './swipe-pager.css';

const DEFAULT_ANIMATION_DURATION = 240;
const DEFAULT_DIRECTION_LOCK_DISTANCE = 8;
const DEFAULT_VELOCITY_ACTIVATION_DISTANCE = 24;
const DEFAULT_VELOCITY_THRESHOLD = 0.5;
const INVALID_DIRECTION_RESISTANCE = 0.12;
const RELEASE_VELOCITY_WINDOW = 100;
const TRANSITION_FALLBACK_BUFFER = 50;

type SwipePagerPhase = 'idle' | 'dragging' | 'settling';
export type SwipePagerDirection = 'previous' | 'next';
export type SwipePagerNavigationSource = 'gesture' | 'programmatic';

/** Describes a page transition requested by the pager. */
export interface SwipePagerChange<PageId> {
  /** Page active before the transition. */
  from: PageId;
  /** Page that will become active. */
  to: PageId;
  /** Logical direction through the configured page order. */
  direction: SwipePagerDirection;
  /** Whether touch input or an imperative command started the transition. */
  source: SwipePagerNavigationSource;
}

/** Configuration for a transform-driven swipe pager. */
export interface SwipePagerOptions<PageId> {
  /** Mounted pages in their current logical order. */
  pageOrder: Accessor<readonly PageId[]>;
  /** The controlled page aligned with the viewport while idle. */
  activePage: Accessor<PageId>;
  /** Commits the destination after its transition finishes. Must update synchronously. */
  onPageChange: (page: PageId, change: SwipePagerChange<PageId>) => void;
  /** Allows a consumer to disable a particular transition. */
  canChangePage?: (change: SwipePagerChange<PageId>) => boolean;
  /** Called when a horizontal touch gesture first claims the surface. */
  onDragStart?: (page: PageId) => void;
  /** Called immediately before a committed transition starts settling. */
  onTransitionStart?: (change: SwipePagerChange<PageId>) => void;
  /** Called after the controlled page has been reconciled at rest. */
  onTransitionEnd?: (change: SwipePagerChange<PageId>) => void;
  /** Allows a consumer to reject a touch based on its initial event. */
  canStart?: (event: TouchEvent) => boolean;
  /** Ignores touches beginning within this distance of either viewport edge. */
  edgeInset?: number;
  /** Distance used to distinguish horizontal and vertical gestures. */
  directionLockDistance?: number;
  /** Distance required to commit, or a fraction of viewport width when below one. */
  activationDistance?: number;
  /** Release velocity in pixels per millisecond that can commit a page change. */
  velocityThreshold?: number;
  /** Duration of programmatic and release animations. */
  animationDuration?: number;
  /** Disables touch gestures while retaining imperative navigation. */
  gesturesEnabled?: boolean;
}

interface ActiveGesture {
  axis: 'x' | 'y' | undefined;
  claimed: boolean;
  currentX: number;
  currentY: number;
  samples: Array<{ time: number; x: number }>;
  startX: number;
  startY: number;
}

interface PendingTransition<PageId> {
  change: SwipePagerChange<PageId>;
  resolve: (changed: boolean) => void;
}

/** Headless controller consumed by `SwipePagerRoot` and `SwipePagerPage`. */
export interface SwipePagerController<PageId> {
  /** Current interaction phase. */
  phase: Accessor<SwipePagerPhase>;
  /** Destination while a committed transition is settling. */
  targetPage: Accessor<PageId | undefined>;
  /** Moves to the previous page in the configured order. */
  previous: () => Promise<boolean>;
  /** Moves to the next page in the configured order. */
  next: () => Promise<boolean>;
  /** Moves to any currently configured page. */
  goTo: (page: PageId, options?: { animate?: boolean }) => Promise<boolean>;
  /** Cancels an active drag or settlement and returns to the active page. */
  cancel: () => void;
  /** Returns whether this page is currently controlled as active. */
  isActive: (page: PageId) => boolean;
  /** Returns the page's position relative to the active page. */
  relativePosition: (page: PageId) => number;
  /** @internal Attaches input and motion to the rendered pager elements. */
  attach: (viewport: HTMLDivElement, rail: HTMLDivElement) => () => void;
  /** @internal Registers a mounted page element for validation and focus state. */
  registerPage: (page: PageId, element: HTMLDivElement) => () => void;
}

/** Creates a generic transform-driven pager for any ordered set of pages. */
export function createSwipePager<PageId>(
  options: SwipePagerOptions<PageId>
): SwipePagerController<PageId> {
  const [phase, setPhase] = createSignal<SwipePagerPhase>('idle');
  const [targetPage, setTargetPage] = createSignal<PageId>();
  const pageElements = new Map<PageId, HTMLDivElement>();

  let viewport: HTMLDivElement | undefined;
  let rail: HTMLDivElement | undefined;
  let activeGesture: ActiveGesture | undefined;
  let dragFrame: number | undefined;
  let dragOffset = 0;
  let pendingTransition: PendingTransition<PageId> | undefined;
  let transitionTimer: number | undefined;
  let suppressClick = false;
  let suppressClickTimer: number | undefined;

  const animationDuration = () =>
    options.animationDuration ?? DEFAULT_ANIMATION_DURATION;

  const prefersReducedMotion = () =>
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  const pageIndex = (page: PageId) => options.pageOrder().indexOf(page);

  const relativePosition = (page: PageId) => {
    const activeIndex = pageIndex(options.activePage());
    const index = pageIndex(page);
    return activeIndex < 0 || index < 0 ? 0 : index - activeIndex;
  };

  const clearTransitionTimer = () => {
    if (transitionTimer === undefined) return;
    clearTimeout(transitionTimer);
    transitionTimer = undefined;
  };

  const clearSuppressClickTimer = () => {
    if (suppressClickTimer === undefined) return;
    clearTimeout(suppressClickTimer);
    suppressClickTimer = undefined;
  };

  const clearDragFrame = () => {
    if (dragFrame === undefined) return;
    cancelAnimationFrame(dragFrame);
    dragFrame = undefined;
  };

  const setRailOffset = (offset: number) => {
    dragOffset = offset;
    if (!rail) return;
    rail.style.transform = offset === 0 ? '' : `translate3d(${offset}px, 0, 0)`;
  };

  const scheduleRailOffset = (offset: number) => {
    dragOffset = offset;
    if (dragFrame !== undefined) return;
    dragFrame = requestAnimationFrame(() => {
      dragFrame = undefined;
      setRailOffset(dragOffset);
    });
  };

  const setTransitionEnabled = (enabled: boolean) => {
    if (!rail) return;
    rail.style.transition = enabled
      ? `transform ${animationDuration()}ms cubic-bezier(0.22, 1, 0.36, 1)`
      : '';
    rail.style.willChange =
      enabled || phase() === 'dragging' ? 'transform' : '';
  };

  const transitionFor = (
    direction: SwipePagerDirection,
    source: SwipePagerNavigationSource,
    explicitPage?: PageId
  ): SwipePagerChange<PageId> | undefined => {
    const order = options.pageOrder();
    const from = options.activePage();
    const fromIndex = order.indexOf(from);
    const toIndex =
      explicitPage === undefined
        ? fromIndex + (direction === 'next' ? 1 : -1)
        : order.indexOf(explicitPage);
    const to = order[toIndex];
    if (fromIndex < 0 || to === undefined || Object.is(from, to)) {
      return undefined;
    }

    const change = { from, to, direction, source };
    return options.canChangePage?.(change) === false ? undefined : change;
  };

  const finishAtRest = () => {
    clearTransitionTimer();
    clearDragFrame();
    setTransitionEnabled(false);
    setRailOffset(0);
    activeGesture = undefined;
    batch(() => {
      setPhase('idle');
      setTargetPage(undefined);
    });
    if (rail) rail.style.willChange = '';
  };

  const finishTransition = () => {
    const pending = pendingTransition;
    pendingTransition = undefined;
    if (!pending) {
      finishAtRest();
      return;
    }

    clearTransitionTimer();
    setTransitionEnabled(false);
    options.onPageChange(pending.change.to, pending.change);
    setRailOffset(0);
    batch(() => {
      setPhase('idle');
      setTargetPage(undefined);
    });
    if (rail) rail.style.willChange = '';
    options.onTransitionEnd?.(pending.change);
    pending.resolve(true);
  };

  const scheduleTransitionFallback = (callback: () => void) => {
    clearTransitionTimer();
    transitionTimer = window.setTimeout(
      callback,
      animationDuration() + TRANSITION_FALLBACK_BUFFER
    );
  };

  const animateBack = () => {
    pendingTransition?.resolve(false);
    pendingTransition = undefined;
    batch(() => {
      setPhase('settling');
      setTargetPage(undefined);
    });

    if (prefersReducedMotion() || dragOffset === 0) {
      finishAtRest();
      return;
    }

    setTransitionEnabled(true);
    setRailOffset(0);
    scheduleTransitionFallback(finishAtRest);
  };

  const startTransition = (change: SwipePagerChange<PageId>, animate = true) =>
    new Promise<boolean>((resolve) => {
      if (!viewport || !rail || phase() === 'settling') {
        resolve(false);
        return;
      }

      clearDragFrame();
      activeGesture = undefined;
      pendingTransition = { change, resolve };
      batch(() => {
        setPhase('settling');
        setTargetPage(() => change.to);
      });
      options.onTransitionStart?.(change);

      const distance =
        (pageIndex(change.to) - pageIndex(change.from)) * viewport.clientWidth;
      if (!animate || prefersReducedMotion() || distance === 0) {
        finishTransition();
        return;
      }

      setTransitionEnabled(true);
      setRailOffset(-distance);
      scheduleTransitionFallback(finishTransition);
    });

  const navigate = (
    direction: SwipePagerDirection,
    source: SwipePagerNavigationSource
  ) => {
    if (phase() !== 'idle') return Promise.resolve(false);
    const change = transitionFor(direction, source);
    return change ? startTransition(change) : Promise.resolve(false);
  };

  const releaseVelocity = (gesture: ActiveGesture, endTime: number) => {
    const samples = gesture.samples.filter(
      (sample) => endTime - sample.time <= RELEASE_VELOCITY_WINDOW
    );
    const first = samples[0];
    const last = samples.at(-1);
    if (!first || !last || last.time <= first.time) return 0;
    return (last.x - first.x) / (last.time - first.time);
  };

  const activationDistance = () => {
    const configured = options.activationDistance;
    if (configured !== undefined) {
      return configured < 1
        ? (viewport?.clientWidth ?? 0) * configured
        : configured;
    }
    return Math.min(96, Math.max(48, (viewport?.clientWidth ?? 0) * 0.2));
  };

  const directionForOffset = (offset: number): SwipePagerDirection =>
    offset < 0 ? 'next' : 'previous';

  const constrainedOffset = (offset: number) => {
    if (offset === 0) return 0;
    const direction = directionForOffset(offset);
    return transitionFor(direction, 'gesture')
      ? offset
      : offset * INVALID_DIRECTION_RESISTANCE;
  };

  const handleTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) {
      const shouldAnimateBack = activeGesture?.claimed;
      activeGesture = undefined;
      if (shouldAnimateBack) animateBack();
      return;
    }
    if (options.gesturesEnabled === false || phase() !== 'idle') return;
    const touch = event.touches[0];
    if (!touch || options.canStart?.(event) === false) {
      activeGesture = undefined;
      return;
    }

    const edgeInset = options.edgeInset ?? 0;
    const viewportBounds = viewport?.getBoundingClientRect();
    if (
      edgeInset > 0 &&
      viewportBounds &&
      (touch.clientX <= viewportBounds.left + edgeInset ||
        touch.clientX >= viewportBounds.right - edgeInset)
    ) {
      activeGesture = undefined;
      return;
    }

    activeGesture = {
      axis: undefined,
      claimed: false,
      currentX: touch.clientX,
      currentY: touch.clientY,
      samples: [{ time: event.timeStamp, x: touch.clientX }],
      startX: touch.clientX,
      startY: touch.clientY,
    };
  };

  const handleTouchMove = (event: TouchEvent) => {
    const gesture = activeGesture;
    const touch = event.touches[0];
    if (!gesture || event.touches.length !== 1 || !touch) {
      const shouldAnimateBack = gesture?.claimed;
      activeGesture = undefined;
      if (shouldAnimateBack) animateBack();
      return;
    }

    gesture.currentX = touch.clientX;
    gesture.currentY = touch.clientY;
    const deltaX = gesture.currentX - gesture.startX;
    const deltaY = gesture.currentY - gesture.startY;
    if (gesture.axis === undefined) {
      const directionLockDistance =
        options.directionLockDistance ?? DEFAULT_DIRECTION_LOCK_DISTANCE;
      if (Math.hypot(deltaX, deltaY) < directionLockDistance) return;
      gesture.axis = Math.abs(deltaX) > Math.abs(deltaY) ? 'x' : 'y';
      if (gesture.axis === 'x') {
        gesture.claimed = true;
        setPhase('dragging');
        if (rail) rail.style.willChange = 'transform';
        options.onDragStart?.(options.activePage());
      }
    }

    if (gesture.axis !== 'x') return;

    gesture.samples.push({ time: event.timeStamp, x: gesture.currentX });
    while (
      gesture.samples.length > 2 &&
      event.timeStamp - gesture.samples[0].time > RELEASE_VELOCITY_WINDOW
    ) {
      gesture.samples.shift();
    }
    scheduleRailOffset(constrainedOffset(deltaX));
    if (event.cancelable) event.preventDefault();
  };

  const suppressSyntheticClick = () => {
    suppressClick = true;
    clearSuppressClickTimer();
    suppressClickTimer = window.setTimeout(() => {
      suppressClick = false;
      suppressClickTimer = undefined;
    }, 400);
  };

  const handleTouchEnd = (event: TouchEvent) => {
    const gesture = activeGesture;
    activeGesture = undefined;
    if (!gesture || gesture.axis !== 'x' || !gesture.claimed) return;
    if (event.touches.length > 0) {
      animateBack();
      return;
    }

    suppressSyntheticClick();
    if (event.cancelable) event.preventDefault();
    clearDragFrame();

    const touch = event.changedTouches[0];
    if (touch) gesture.currentX = touch.clientX;
    const rawOffset = gesture.currentX - gesture.startX;
    const direction = directionForOffset(rawOffset);
    const change = transitionFor(direction, 'gesture');
    if (!change) {
      animateBack();
      return;
    }

    const velocity = releaseVelocity(gesture, event.timeStamp);
    const velocityThreshold =
      options.velocityThreshold ?? DEFAULT_VELOCITY_THRESHOLD;
    const commitsByDistance = Math.abs(rawOffset) >= activationDistance();
    const commitsByVelocity =
      Math.abs(rawOffset) >= DEFAULT_VELOCITY_ACTIVATION_DISTANCE &&
      Math.abs(velocity) >= velocityThreshold &&
      Math.sign(velocity) === Math.sign(rawOffset);

    if (commitsByDistance || commitsByVelocity) {
      void startTransition(change);
    } else {
      animateBack();
    }
  };

  const handleTouchCancel = () => {
    if (!activeGesture?.claimed) {
      activeGesture = undefined;
      return;
    }
    activeGesture = undefined;
    animateBack();
  };

  const handleClick = (event: MouseEvent) => {
    if (!suppressClick) return;
    suppressClick = false;
    clearSuppressClickTimer();
    event.preventDefault();
    event.stopPropagation();
  };

  const handleTransitionEnd = (event: TransitionEvent) => {
    if (event.target !== rail || event.propertyName !== 'transform') return;
    if (pendingTransition) finishTransition();
    else finishAtRest();
  };

  const controller: SwipePagerController<PageId> = {
    phase,
    targetPage,
    previous: () => navigate('previous', 'programmatic'),
    next: () => navigate('next', 'programmatic'),
    goTo(page, navigationOptions) {
      if (phase() !== 'idle') return Promise.resolve(false);
      const fromIndex = pageIndex(options.activePage());
      const toIndex = pageIndex(page);
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) {
        return Promise.resolve(false);
      }
      const direction = toIndex > fromIndex ? 'next' : 'previous';
      const change = transitionFor(direction, 'programmatic', page);
      return change
        ? startTransition(change, navigationOptions?.animate !== false)
        : Promise.resolve(false);
    },
    cancel() {
      if (phase() === 'idle' && !activeGesture) return;
      pendingTransition?.resolve(false);
      pendingTransition = undefined;
      suppressClick = false;
      clearSuppressClickTimer();
      finishAtRest();
    },
    isActive: (page) => Object.is(options.activePage(), page),
    relativePosition,
    attach(nextViewport, nextRail) {
      viewport = nextViewport;
      rail = nextRail;
      viewport.addEventListener('touchstart', handleTouchStart, {
        passive: true,
      });
      viewport.addEventListener('touchmove', handleTouchMove, {
        passive: false,
      });
      viewport.addEventListener('touchend', handleTouchEnd, {
        passive: false,
      });
      viewport.addEventListener('touchcancel', handleTouchCancel, {
        passive: true,
      });
      viewport.addEventListener('click', handleClick, true);
      rail.addEventListener('transitionend', handleTransitionEnd);

      let observedWidth = viewport.clientWidth;
      const resizeObserver =
        typeof ResizeObserver === 'undefined'
          ? undefined
          : new ResizeObserver(([entry]) => {
              const nextWidth =
                entry?.contentRect.width ?? viewport?.clientWidth;
              if (nextWidth === undefined || nextWidth === observedWidth)
                return;
              observedWidth = nextWidth;
              if (phase() !== 'idle') controller.cancel();
            });
      resizeObserver?.observe(viewport);

      return () => {
        controller.cancel();
        clearTransitionTimer();
        clearSuppressClickTimer();
        clearDragFrame();
        resizeObserver?.disconnect();
        nextViewport.removeEventListener('touchstart', handleTouchStart);
        nextViewport.removeEventListener('touchmove', handleTouchMove);
        nextViewport.removeEventListener('touchend', handleTouchEnd);
        nextViewport.removeEventListener('touchcancel', handleTouchCancel);
        nextViewport.removeEventListener('click', handleClick, true);
        nextRail.removeEventListener('transitionend', handleTransitionEnd);
        viewport = undefined;
        rail = undefined;
      };
    },
    registerPage(page, element) {
      pageElements.set(page, element);
      return () => {
        if (pageElements.get(page) === element) pageElements.delete(page);
      };
    },
  };

  onCleanup(() => {
    controller.cancel();
    clearTransitionTimer();
    clearSuppressClickTimer();
    clearDragFrame();
  });

  return controller;
}

export type SwipePagerRootProps<PageId> = ParentProps<
  Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children' | 'ref'> & {
    /** Pager controller created by `createSwipePager`. */
    controller: SwipePagerController<PageId>;
    /** Receives the pager viewport. */
    ref?: (element: HTMLDivElement) => void;
  }
>;

/** Viewport and transform rail for a swipe pager. */
export function SwipePagerRoot<PageId>(props: SwipePagerRootProps<PageId>) {
  const [local, elementProps] = splitProps(props, [
    'children',
    'class',
    'controller',
    'ref',
  ]);
  let viewport!: HTMLDivElement;
  let rail!: HTMLDivElement;

  onMount(() => {
    const detach = local.controller.attach(viewport, rail);
    onCleanup(detach);
  });

  return (
    <div
      {...elementProps}
      ref={mergeRefs((element) => {
        viewport = element;
      }, local.ref)}
      class={`swipe-pager ${local.class ?? ''}`}
      data-phase={local.controller.phase()}
    >
      <div
        ref={(element) => {
          rail = element;
        }}
        class="swipe-pager-rail"
      >
        {local.children}
      </div>
    </div>
  );
}

export type SwipePagerPageProps<PageId> = ParentProps<{
  /** Pager controller owning this page. */
  controller: SwipePagerController<PageId>;
  /** Stable identity included in the controller's current page order. */
  id: PageId;
  /** Additional page-wrapper classes. */
  class?: string;
}>;

/** A stable physical page positioned according to the controller's page order. */
export function SwipePagerPage<PageId>(props: SwipePagerPageProps<PageId>) {
  let element!: HTMLDivElement;
  const pageId = props.id;

  onMount(() => {
    const unregister = props.controller.registerPage(pageId, element);
    onCleanup(unregister);
  });

  return (
    <div
      ref={(pageElement) => {
        element = pageElement;
      }}
      class={`swipe-pager-page ${props.class ?? ''}`}
      style={{
        '--swipe-pager-page-position': props.controller.relativePosition(
          props.id
        ),
      }}
      aria-hidden={!props.controller.isActive(props.id)}
      inert={!props.controller.isActive(props.id)}
    >
      {props.children}
    </div>
  );
}
