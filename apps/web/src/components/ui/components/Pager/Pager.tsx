import { createResizeObserver } from '@solid-primitives/resize-observer';
import {
  type Accessor,
  batch,
  createContext,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  type ParentProps,
  splitProps,
  useContext,
} from 'solid-js';
import './pager.css';

const DEFAULT_ANIMATION_DURATION = 140;
const RAPID_NAVIGATION_CLICK_THRESHOLD = DEFAULT_ANIMATION_DURATION + 10;
const TRANSITION_FALLBACK_BUFFER = 50;

type PagerPhase = 'idle' | 'dragging' | 'settling';
export type PagerDirection = 'previous' | 'next';
export type PagerNavigationSource = 'gesture' | 'programmatic';

/** Describes a page transition requested by the pager. */
export interface PagerChange<PageId> {
  /** Page active before the transition. */
  from: PageId;
  /** Page that will become active. */
  to: PageId;
  /** Logical direction through the configured page order. */
  direction: PagerDirection;
  /** Whether a gesture or imperative command started the transition. */
  source: PagerNavigationSource;
}

/** Configuration for a transform-driven pager. */
export interface PagerOptions<PageId> {
  /** Mounted pages in their current logical order. */
  pageOrder: Accessor<readonly PageId[]>;
  /** The controlled page aligned with the viewport while idle. */
  activePage: Accessor<PageId>;
  /** Commits the destination after its transition finishes. Must update synchronously. */
  onPageChange: (page: PageId, change: PagerChange<PageId>) => void;
  /** Allows a consumer to disable a particular transition. */
  canChangePage?: (change: PagerChange<PageId>) => boolean;
  /** Called when an external gesture starts moving the pager. */
  onDragStart?: (page: PageId) => void;
  /** Called immediately before a committed transition starts settling. */
  onTransitionStart?: (change: PagerChange<PageId>) => void;
  /** Called after the controlled page has been reconciled at rest. */
  onTransitionEnd?: (change: PagerChange<PageId>) => void;
  /** Duration of programmatic and release animations. */
  animationDuration?: number;
}

interface PendingTransition<PageId> {
  change: PagerChange<PageId>;
  resolve: (changed: boolean) => void;
}

/** Headless controller provided by `Pager.Root`. */
export interface PagerController<PageId> {
  /** Current interaction phase. */
  phase: Accessor<PagerPhase>;
  /** Destination while a committed transition is settling. */
  targetPage: Accessor<PageId | undefined>;
  /** Currently mounted pager viewport. */
  viewport: Accessor<HTMLDivElement | undefined>;
  /** Moves to the previous page in the configured order. */
  previous: () => Promise<boolean>;
  /** Moves to the next page in the configured order. */
  next: () => Promise<boolean>;
  /** Moves to any currently configured page. */
  goTo: (page: PageId, options?: { animate?: boolean }) => Promise<boolean>;
  /** Immediately cancels an active drag or transition. */
  cancel: () => void;
  /** Begins an externally controlled drag. */
  beginDrag: () => boolean;
  /** Moves the page rail during an externally controlled drag. */
  updateDrag: (offset: number) => void;
  /** Commits an externally controlled drag in one direction. */
  commitDrag: (direction: PagerDirection) => Promise<boolean>;
  /** Animates an externally controlled drag back to the active page. */
  cancelDrag: () => void;
  /** Returns whether this page is currently controlled as active. */
  isActive: (page: PageId) => boolean;
  /** Returns the page's position relative to the active page. */
  relativePosition: (page: PageId) => number;
  /** @internal Attaches motion to the rendered viewport and rail. */
  attachViewport: (
    viewport: HTMLDivElement,
    rail: HTMLDivElement
  ) => () => void;
}

/** Creates a generic transform-driven pager for any ordered set of pages. */
export function createPager<PageId>(
  options: PagerOptions<PageId>
): PagerController<PageId> {
  const [phase, setPhase] = createSignal<PagerPhase>('idle');
  const [targetPage, setTargetPage] = createSignal<PageId>();
  const [viewport, setViewport] = createSignal<HTMLDivElement>();

  let rail: HTMLDivElement | undefined;
  let dragFrame: number | undefined;
  let dragOffset = 0;
  let pendingTransition: PendingTransition<PageId> | undefined;
  let transitionTimer: number | undefined;
  let observedViewportWidth: number | undefined;
  let lastProgrammaticNavigationAt = Number.NEGATIVE_INFINITY;

  const animationDuration = () =>
    options.animationDuration ?? DEFAULT_ANIMATION_DURATION;

  const prefersReducedMotion = () =>
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  const pageIndex = (page: PageId) => options.pageOrder().indexOf(page);

  const relativePosition = (page: PageId) => {
    const activeIndex = pageIndex(options.activePage());
    const index = pageIndex(page);

    if (activeIndex < 0 || index < 0) return 0;

    return index - activeIndex;
  };

  const clearTransitionTimer = () => {
    if (transitionTimer === undefined) return;

    clearTimeout(transitionTimer);
    transitionTimer = undefined;
  };

  const clearDragFrame = () => {
    if (dragFrame === undefined) return;

    cancelAnimationFrame(dragFrame);
    dragFrame = undefined;
  };

  const setRailOffset = (offset: number) => {
    dragOffset = offset;
    if (!rail) return;

    if (offset === 0) {
      rail.style.transform = '';
      return;
    }

    rail.style.transform = `translate3d(${offset}px, 0, 0)`;
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

    if (!enabled) {
      rail.style.transition = '';
      rail.style.willChange = phase() === 'dragging' ? 'transform' : '';
      return;
    }

    rail.style.transition = `transform ${animationDuration()}ms cubic-bezier(0.22, 1, 0.36, 1)`;
    rail.style.willChange = 'transform';
  };

  const transitionFor = (
    direction: PagerDirection,
    source: PagerNavigationSource,
    explicitPage?: PageId
  ): PagerChange<PageId> | undefined => {
    const order = options.pageOrder();
    const from = options.activePage();
    const fromIndex = order.indexOf(from);
    let toIndex: number;

    if (explicitPage === undefined) {
      const offset = direction === 'next' ? 1 : -1;
      toIndex = fromIndex + offset;
    } else {
      toIndex = order.indexOf(explicitPage);
    }

    const to = order[toIndex];
    if (fromIndex < 0 || to === undefined || Object.is(from, to)) {
      return undefined;
    }

    const change = { from, to, direction, source };
    if (options.canChangePage?.(change) === false) return undefined;

    return change;
  };

  const finishAtRest = () => {
    clearTransitionTimer();
    clearDragFrame();
    setTransitionEnabled(false);
    setRailOffset(0);
    batch(() => {
      setPhase('idle');
      setTargetPage(undefined);
    });
    if (rail) rail.style.willChange = '';
  };

  const transitionDistance = (change: PagerChange<PageId>) => {
    const viewportElement = viewport();
    if (!viewportElement) return 0;

    const pageDistance = pageIndex(change.to) - pageIndex(change.from);
    return pageDistance * viewportElement.clientWidth;
  };

  const finishTransition = () => {
    const pending = pendingTransition;
    pendingTransition = undefined;
    if (!pending) {
      finishAtRest();
      return;
    }

    clearTransitionTimer();
    clearDragFrame();
    setTransitionEnabled(false);
    setRailOffset(-transitionDistance(pending.change));
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

  const startTransition = (change: PagerChange<PageId>, animate = true) =>
    new Promise<boolean>((resolve) => {
      const viewportElement = viewport();
      if (!viewportElement || !rail || phase() === 'settling') {
        resolve(false);
        return;
      }

      clearDragFrame();
      pendingTransition = { change, resolve };
      batch(() => {
        setPhase('settling');
        setTargetPage(() => change.to);
      });
      options.onTransitionStart?.(change);

      const distance = transitionDistance(change);
      if (!animate || prefersReducedMotion() || distance === 0) {
        finishTransition();
        return;
      }

      setTransitionEnabled(true);
      setRailOffset(-distance);
      scheduleTransitionFallback(finishTransition);
    });

  const navigate = (
    direction: PagerDirection,
    source: PagerNavigationSource
  ) => {
    if (phase() === 'dragging') return Promise.resolve(false);

    const now = Date.now();
    const interruptedTransition = phase() === 'settling';
    const isRapidNavigation =
      source === 'programmatic' &&
      now - lastProgrammaticNavigationAt <= RAPID_NAVIGATION_CLICK_THRESHOLD;

    if (interruptedTransition) {
      if (pendingTransition) {
        finishTransition();
      } else {
        finishAtRest();
      }
    }

    if (phase() !== 'idle') return Promise.resolve(false);

    const change = transitionFor(direction, source);
    if (!change) return Promise.resolve(false);

    if (source === 'programmatic') lastProgrammaticNavigationAt = now;

    const animate = !interruptedTransition && !isRapidNavigation;
    return startTransition(change, animate);
  };

  const handleTransitionEnd = (event: TransitionEvent) => {
    if (event.target !== rail || event.propertyName !== 'transform') return;

    if (pendingTransition) {
      finishTransition();
      return;
    }

    finishAtRest();
  };

  createResizeObserver(viewport, ({ width }) => {
    if (observedViewportWidth === undefined) {
      observedViewportWidth = width;
      return;
    }

    if (width === observedViewportWidth) return;

    observedViewportWidth = width;
    if (phase() === 'idle') return;

    controller.cancel();
  });

  const controller: PagerController<PageId> = {
    phase,
    targetPage,
    viewport,
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
      if (!change) return Promise.resolve(false);

      return startTransition(change, navigationOptions?.animate !== false);
    },
    cancel() {
      if (phase() === 'idle') return;
      pendingTransition?.resolve(false);
      pendingTransition = undefined;
      finishAtRest();
    },
    beginDrag() {
      if (!viewport() || !rail || phase() !== 'idle') return false;

      setPhase('dragging');
      rail.style.willChange = 'transform';
      options.onDragStart?.(options.activePage());
      return true;
    },
    updateDrag(offset) {
      if (phase() !== 'dragging') return;

      const direction: PagerDirection = offset < 0 ? 'next' : 'previous';
      const constrainedOffset = transitionFor(direction, 'gesture')
        ? offset
        : offset * 0.12;
      scheduleRailOffset(constrainedOffset);
    },
    commitDrag(direction) {
      if (phase() !== 'dragging') return Promise.resolve(false);

      const change = transitionFor(direction, 'gesture');
      if (!change) {
        animateBack();
        return Promise.resolve(false);
      }
      return startTransition(change);
    },
    cancelDrag() {
      if (phase() !== 'dragging') return;
      animateBack();
    },
    isActive: (page) => Object.is(options.activePage(), page),
    relativePosition,
    attachViewport(nextViewport, nextRail) {
      observedViewportWidth = nextViewport.clientWidth;
      setViewport(nextViewport);

      rail = nextRail;
      rail.addEventListener('transitionend', handleTransitionEnd);

      return () => {
        controller.cancel();
        clearTransitionTimer();
        clearDragFrame();
        nextRail.removeEventListener('transitionend', handleTransitionEnd);
        setViewport(undefined);
        observedViewportWidth = undefined;
        rail = undefined;
      };
    },
  };

  onCleanup(() => {
    controller.cancel();
    clearTransitionTimer();
    clearDragFrame();
  });

  return controller;
}

const PagerContext = createContext<PagerController<unknown>>();

/** Returns the controller provided by the nearest `Pager.Root`. */
export function usePager<PageId>(): PagerController<PageId> {
  const controller = useContext(PagerContext) as
    | PagerController<PageId>
    | undefined;
  if (!controller) {
    throw new Error('Pager components must be used within Pager.Root');
  }

  return controller;
}

export type PagerRootProps<PageId> = ParentProps<{
  /** Pager controller created by `createPager`. */
  controller: PagerController<PageId>;
}>;

/** Provides one pager controller to controls, a viewport, and pages. */
export function PagerRoot<PageId>(props: PagerRootProps<PageId>) {
  return (
    <PagerContext.Provider
      value={props.controller as unknown as PagerController<unknown>}
    >
      {props.children}
    </PagerContext.Provider>
  );
}

export type PagerViewportProps = ParentProps<
  Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children' | 'ref'>
>;

/** Renders the clipping viewport and transform rail for pager pages. */
export function PagerViewport(props: PagerViewportProps) {
  const controller = usePager<unknown>();
  const [local, elementProps] = splitProps(props, ['children', 'class']);
  let viewport!: HTMLDivElement;
  let rail!: HTMLDivElement;

  onMount(() => {
    const detach = controller.attachViewport(viewport, rail);
    onCleanup(detach);
  });

  return (
    <div
      {...elementProps}
      ref={viewport}
      class={`pager ${local.class ?? ''}`}
      data-phase={controller.phase()}
    >
      <div ref={rail} class="pager-rail">
        {local.children}
      </div>
    </div>
  );
}

export type PagerPageProps<PageId> = ParentProps<{
  /** Stable identity included in the controller's current page order. */
  id: PageId;
  /** Additional page-wrapper classes. */
  class?: string;
}>;

/** A stable physical page positioned by its nearest pager controller. */
export function PagerPage<PageId>(props: PagerPageProps<PageId>) {
  const controller = usePager<PageId>();

  return (
    <div
      class={`pager-page ${props.class ?? ''}`}
      style={{
        '--pager-page-position': controller.relativePosition(props.id),
      }}
      aria-hidden={!controller.isActive(props.id)}
      inert={!controller.isActive(props.id)}
    >
      {props.children}
    </div>
  );
}
