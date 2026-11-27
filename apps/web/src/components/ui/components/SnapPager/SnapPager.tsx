import {
  type Accessor,
  batch,
  createContext,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  type ParentProps,
  splitProps,
  useContext,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import './snap-pager.css';

const TRACK_MIDDLE = 1000;
const TRACK_PAGES = TRACK_MIDDLE * 2 + 1;
const SLOT_COUNT = 7;
const INITIAL_POSITIONS = [0, -1, 1, -2, 2, -3, 3];
const QUIET_MS = 350;
const RAPID_MS = 300;
const NO_SCROLL_MS = 150;
// These stationary snap areas never change identity when a calendar slot moves.
const snapMarkers = Array.from({ length: TRACK_PAGES }, (_, index) => index);

// CSS sizes each page to the viewport's fractional width and places page N at
// N widths, so offsets use that width. clientWidth rounds it, which put page
// 1,000 up to 500px off screen.
const pageWidth = (element: HTMLElement) =>
  element.getBoundingClientRect().width;

type SnapPagerPhase = 'idle' | 'scrolling';
interface PagerState {
  position: number;
  fractionalPosition: number;
  phase: SnapPagerPhase;
  locked: boolean;
  nativeScrolling: boolean;
  trackOrigin: number;
}

export interface SnapPage {
  /** Stable mounted identity; its logical position changes during scrolling. */
  key: number;
  position: Accessor<number>;
}

export type SnapPagerOptions = {
  onSettle?: (moved: number) => void;
  onNavigationCancel?: () => void;
};

export type SnapPagerController = {
  pages: Accessor<readonly SnapPage[]>;
  activePage: Accessor<number>;
  position: Accessor<number>;
  fractionalPosition: Accessor<number>;
  targetPosition: () => number;
  phase: Accessor<SnapPagerPhase>;
  nativeScrolling: Accessor<boolean>;
  canStep: () => boolean;
  next: () => void;
  previous: () => void;
  goTo: (offset: number) => void;
  reset: () => void;
  setLocked: (value: boolean) => void;
  locked: Accessor<boolean>;
  resize: () => void;
  attachViewport: (element: HTMLDivElement) => () => void;
  /** Logical origin of the physical track, used to position the seven slots. */
  trackOrigin: Accessor<number>;
};

/** Seven persistent pages on a native, 2,001-position snap track. */
export function createSnapPager(
  options: SnapPagerOptions = {}
): SnapPagerController {
  const [state, setState] = createStore<PagerState>({
    position: 0,
    fractionalPosition: 0,
    phase: 'idle',
    locked: false,
    nativeScrolling: false,
    trackOrigin: 0,
  });
  const position = () => state.position;
  const fractionalPosition = () => state.fractionalPosition;
  const phase = () => state.phase;
  const locked = () => state.locked;
  const nativeScrolling = () => state.nativeScrolling;
  const trackOrigin = () => state.trackOrigin;
  const setPosition = (value: number) => setState('position', value);
  const setFractionalPosition = (value: number) =>
    setState('fractionalPosition', value);
  const setPhase = (value: SnapPagerPhase) => setState('phase', value);
  const setLockedSignal = (value: boolean) => setState('locked', value);
  const setNativeScrolling = (value: boolean) =>
    setState('nativeScrolling', value);
  const setTrackOrigin = (value: number) => setState('trackOrigin', value);
  const slots = INITIAL_POSITIONS.map((position) => createSignal(position));
  const pages: readonly SnapPage[] = slots.map(([slot], key) => ({
    key,
    position: slot,
  }));
  let viewport: HTMLDivElement | undefined;
  let width = 0;
  let frame: number | undefined;
  let noScrollTimer: ReturnType<typeof setTimeout> | undefined;
  let lastMoveAt = 0;
  let lastLeft = 0;
  let lastCommandAt: number | undefined;
  let commandTarget: number | undefined;
  let queuedTarget: number | undefined;
  let reportedPosition = 0;
  let touchHeld = false;
  let pointerHeld = false;
  let needsAlignment = false;
  let initialScroll = false;
  let resizePending = false;
  let lockedPosition = 0;
  let lastWheelMagnitude = 0;
  let navigationVersion = 0;

  const held = () => touchHeld || pointerHeld;
  const targetPosition = () => queuedTarget ?? commandTarget ?? position();
  const activePage = () =>
    pages.find((page) => page.position() === position())?.key ?? 0;

  const cancelRequests = () => {
    navigationVersion++;
    commandTarget = undefined;
    queuedTarget = undefined;
    options.onNavigationCancel?.();
  };

  const assign = (center: number) => {
    // Reuse only slots outside the new window; a large jump reassigns all seven.
    const needed = Array.from(
      { length: SLOT_COUNT },
      (_, index) => center + index - 3
    );
    const missing = needed.filter(
      (value) => !slots.some(([slot]) => slot() === value)
    );
    const available = slots.filter(([slot]) => !needed.includes(slot()));
    batch(() => {
      available.forEach(([, setSlot], index) => setSlot(missing[index]));
      setPosition(center);
    });
  };

  const sample = () => {
    const element = viewport;
    if (!element?.clientWidth || locked()) return;
    const left = element.scrollLeft;
    if (pageWidth(element) !== width || needsAlignment) {
      if (left !== lastLeft) {
        lastLeft = left;
        lastMoveAt = Date.now();
      }
      return;
    }
    const fractional = trackOrigin() + left / pageWidth(element) - TRACK_MIDDLE;
    const center = Math.round(fractional);
    batch(() => {
      assign(center);
      setFractionalPosition(fractional);
    });
    if (left !== lastLeft) {
      lastLeft = left;
      lastMoveAt = Date.now();
    }
  };

  const clearFrame = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
  };
  const clearNoScroll = () => {
    if (noScrollTimer !== undefined) clearTimeout(noScrollTimer);
    noScrollTimer = undefined;
  };
  const report = () => {
    const moved = position() - reportedPosition;
    reportedPosition = position();
    options.onSettle?.(moved);
  };
  const recenter = () => {
    const element = viewport;
    if (!element?.clientWidth || nativeScrolling() || held() || locked())
      return;
    const relative = position() - trackOrigin();
    if (Math.abs(relative) < 900) return;
    // Only idle track boundaries move the physical origin. Markers stay fixed.
    setTrackOrigin(position());
    element.scrollLeft = TRACK_MIDDLE * pageWidth(element);
    lastLeft = element.scrollLeft;
  };

  const writeTarget = (target: number, smooth: boolean) => {
    const element = viewport;
    if (!element?.clientWidth) return;
    const left = (TRACK_MIDDLE + target - trackOrigin()) * pageWidth(element);
    const reduced = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)'
    ).matches;
    if (smooth && !reduced && typeof element.scrollTo === 'function') {
      element.scrollTo({ left, behavior: 'smooth' });
    } else {
      element.scrollLeft = left;
      sample();
    }
    lastMoveAt = Date.now();
    startFrame();
  };

  const finish = () => {
    if (held() || !viewport?.clientWidth) return;
    if (resizePending) {
      width = pageWidth(viewport);
      resizePending = false;
      viewport.scrollLeft =
        (TRACK_MIDDLE + fractionalPosition() - trackOrigin()) * width;
      lastLeft = viewport.scrollLeft;
    }
    if (needsAlignment && !locked()) {
      needsAlignment = false;
      writeTarget(lockedPosition, false);
    } else if (!needsAlignment) sample();
    setNativeScrolling(false);
    if (queuedTarget !== undefined) {
      // External settlement can reset the pager or replace navigation. Consume
      // the old request before the callback and reject its stale continuation.
      const target = queuedTarget;
      const version = navigationVersion;
      queuedTarget = undefined;
      setPhase('idle');
      report();
      if (version !== navigationVersion) return;
      commandTarget = target;
      setPhase('scrolling');
      writeTarget(target, true);
      return;
    }
    if (commandTarget !== undefined) {
      if (Math.abs(fractionalPosition() - commandTarget) > 0.01 && !locked()) {
        writeTarget(commandTarget, false);
      }
      commandTarget = undefined;
    }
    setPhase('idle');
    lastWheelMagnitude = 0;
    report();
    recenter();
  };

  const startFrame = () => {
    if (frame !== undefined || !viewport) return;
    const tick = () => {
      frame = undefined;
      if (!viewport) return;
      if (
        viewport.scrollLeft !== lastLeft &&
        commandTarget === undefined &&
        !needsAlignment &&
        !locked()
      )
        beginNative();
      sample();
      if (held()) {
        startFrame();
      } else if (Date.now() - lastMoveAt >= QUIET_MS) {
        finish();
      } else {
        startFrame();
      }
    };
    frame = requestAnimationFrame(tick);
  };

  const beginNative = () => {
    if (locked() || nativeScrolling()) return;
    if (commandTarget !== undefined || queuedTarget !== undefined)
      cancelRequests();
    setNativeScrolling(true);
    setPhase('scrolling');
    lastMoveAt = Date.now();
    startFrame();
  };
  const onScroll = () => {
    if (!viewport?.clientWidth) return;
    if (initialScroll) {
      initialScroll = false;
      if (viewport.scrollLeft === lastLeft) return;
    }
    // A scroll event can arrive before the wheel event (or without one).
    if (
      viewport.scrollLeft !== lastLeft &&
      phase() === 'idle' &&
      !needsAlignment &&
      !locked()
    )
      beginNative();
    sample();
    if (phase() !== 'idle') startFrame();
  };
  const onWheel = (event: WheelEvent) => {
    if (locked() || event.ctrlKey) return;
    const magnitude = Math.abs(
      event.deltaX || (event.shiftKey ? event.deltaY : 0)
    );
    if (magnitude === 0) return;
    // A fresh rising impulse supersedes a queued command, not its decaying tail.
    if (magnitude > lastWheelMagnitude * 1.5) cancelRequests();
    lastWheelMagnitude = magnitude;
    beginNative();
    lastMoveAt = Date.now();
    startFrame();
  };
  const onScrollEnd = () => {
    // An old scrollend is not proof that a new wheel's momentum has ended.
    if (!held() && phase() !== 'idle') startFrame();
  };
  const touchStart = () => {
    if (!touchHeld) cancelRequests();
    touchHeld = true;
    clearNoScroll();
    startFrame();
  };
  const touchEnd = (event: TouchEvent) => {
    if (event.touches.length) return;
    touchHeld = false;
    release();
  };
  const pointerStart = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    if (!pointerHeld) cancelRequests();
    pointerHeld = true;
    clearNoScroll();
    startFrame();
  };
  const pointerEnd = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    pointerHeld = false;
    release();
  };
  const release = () => {
    if (held() || !nativeScrolling()) return;
    // A stationary contact has no scrollend; recover without changing scrollLeft.
    if (Math.abs((viewport?.scrollLeft ?? lastLeft) - lastLeft) < 1) {
      clearNoScroll();
      noScrollTimer = setTimeout(() => {
        noScrollTimer = undefined;
        if (viewport && !held() && Date.now() - lastMoveAt >= NO_SCROLL_MS) {
          finish();
        }
      }, NO_SCROLL_MS);
    }
    startFrame();
  };

  const command = (offset: number) => {
    if (locked() || !Number.isInteger(offset) || offset === 0) return;
    navigationVersion++;
    const target = targetPosition() + offset;
    if (nativeScrolling() || held()) {
      queuedTarget = target;
      return;
    }
    const now = Date.now();
    const rapid =
      commandTarget !== undefined ||
      (lastCommandAt !== undefined && now - lastCommandAt < RAPID_MS);
    lastCommandAt = now;
    commandTarget = target;
    setPhase('scrolling');
    if (!viewport) {
      assign(target);
      setFractionalPosition(target);
      commandTarget = undefined;
      setPhase('idle');
      report();
    } else if (viewport.clientWidth) {
      writeTarget(target, !rapid);
      if (rapid) finish();
    }
  };

  const detach = (element: HTMLDivElement) => {
    element.removeEventListener('scroll', onScroll);
    element.removeEventListener('scrollend', onScrollEnd);
    element.removeEventListener('wheel', onWheel);
    element.removeEventListener('touchstart', touchStart, true);
    element.removeEventListener('pointerdown', pointerStart, true);
    if (viewport !== element) return;
    window.removeEventListener('touchend', touchEnd, true);
    window.removeEventListener('touchcancel', touchEnd, true);
    window.removeEventListener('pointerup', pointerEnd, true);
    window.removeEventListener('pointercancel', pointerEnd, true);
    clearFrame();
    navigationVersion++;
    clearNoScroll();
    viewport = undefined;
    touchHeld = false;
    pointerHeld = false;
    commandTarget = undefined;
    queuedTarget = undefined;
    setNativeScrolling(false);
    setPhase('idle');
  };

  const resize = () => {
    if (!viewport) return;
    const nextWidth = pageWidth(viewport);
    if (nextWidth === width && !resizePending) return;
    resizePending = true;
    if (!nextWidth) return;
    if (nativeScrolling() || held() || needsAlignment) {
      startFrame();
      return;
    }
    const preserved = commandTarget ?? fractionalPosition();
    width = nextWidth;
    resizePending = false;
    viewport.scrollLeft = (TRACK_MIDDLE + preserved - trackOrigin()) * width;
    lastLeft = viewport.scrollLeft;
    sample();
    if (commandTarget !== undefined) writeTarget(commandTarget, false);
  };

  return {
    pages: () => pages,
    activePage,
    position,
    fractionalPosition,
    targetPosition,
    trackOrigin,
    phase,
    nativeScrolling,
    locked,
    canStep: () => !locked(),
    next: () => command(1),
    previous: () => command(-1),
    goTo: command,
    reset() {
      navigationVersion++;
      clearFrame();
      clearNoScroll();
      if (commandTarget !== undefined || queuedTarget !== undefined) {
        options.onNavigationCancel?.();
      }
      commandTarget = undefined;
      queuedTarget = undefined;
      lastCommandAt = undefined;
      reportedPosition = 0;
      needsAlignment = false;
      batch(() => {
        slots.forEach(([, setSlot], index) =>
          setSlot(INITIAL_POSITIONS[index])
        );
        setTrackOrigin(0);
        setPosition(0);
        setFractionalPosition(0);
        setNativeScrolling(false);
        setPhase('idle');
      });
      if (viewport?.clientWidth) {
        viewport.scrollLeft = TRACK_MIDDLE * pageWidth(viewport);
        lastLeft = viewport.scrollLeft;
      }
    },
    setLocked(value) {
      if (value === locked()) return;
      if (value) cancelRequests();
      setLockedSignal(value);
      if (value) {
        lockedPosition = position();
        needsAlignment = true;
      } else if (nativeScrolling() || held()) {
        startFrame();
      } else if (viewport?.clientWidth) {
        needsAlignment = false;
        commandTarget = lockedPosition;
        writeTarget(lockedPosition, false);
        finish();
      }
    },
    resize,
    attachViewport(element) {
      if (viewport) detach(viewport);
      viewport = element;
      width = pageWidth(element);
      element.addEventListener('scroll', onScroll);
      element.addEventListener('scrollend', onScrollEnd);
      element.addEventListener('wheel', onWheel, { passive: true });
      element.addEventListener('touchstart', touchStart, {
        passive: true,
        capture: true,
      });
      element.addEventListener('pointerdown', pointerStart, {
        passive: true,
        capture: true,
      });
      window.addEventListener('touchend', touchEnd, true);
      window.addEventListener('touchcancel', touchEnd, true);
      window.addEventListener('pointerup', pointerEnd, true);
      window.addEventListener('pointercancel', pointerEnd, true);
      if (width) {
        initialScroll = true;
        element.scrollLeft =
          (TRACK_MIDDLE + fractionalPosition() - trackOrigin()) * width;
        lastLeft = element.scrollLeft;
      }
      return () => detach(element);
    },
  };
}

const SnapPagerContext = createContext<SnapPagerController>();

export function useSnapPager(): SnapPagerController {
  const controller = useContext(SnapPagerContext);
  if (!controller)
    throw new Error('SnapPager components require SnapPager.Root');
  return controller;
}

export type SnapPagerRootProps = ParentProps<{
  controller: SnapPagerController;
}>;

export function SnapPagerRoot(props: SnapPagerRootProps) {
  return (
    <SnapPagerContext.Provider value={props.controller}>
      {props.children}
    </SnapPagerContext.Provider>
  );
}

export type SnapPagerViewportProps = ParentProps<
  Omit<JSX.HTMLAttributes<HTMLDivElement>, 'children' | 'ref'>
>;

export function SnapPagerViewport(props: SnapPagerViewportProps) {
  const controller = useSnapPager();
  const [local, rest] = splitProps(props, ['children', 'class', 'classList']);
  let element!: HTMLDivElement;
  onMount(() => {
    const detach = controller.attachViewport(element);
    let width = pageWidth(element);
    const observer = new ResizeObserver(() => {
      if (pageWidth(element) === width) return;
      width = pageWidth(element);
      controller.resize();
    });
    observer.observe(element);
    onCleanup(() => {
      observer.disconnect();
      detach();
    });
  });
  return (
    <div
      {...rest}
      ref={element}
      class={`snap-pager ${local.class ?? ''}`}
      classList={{
        ...local.classList,
        'snap-pager-locked': controller.locked(),
      }}
    >
      <div class="snap-pager-rail">
        <div class="snap-pager-markers" aria-hidden="true">
          <For each={snapMarkers}>
            {(index) => (
              <div
                class="snap-pager-marker"
                style={{ '--snap-marker-position': index }}
              />
            )}
          </For>
        </div>
        {local.children}
      </div>
    </div>
  );
}

export type SnapPagerPageProps = ParentProps<{
  page: SnapPage;
  class?: string;
  /** Override interaction ownership for a read-only page projection. */
  inert?: boolean;
}>;

export function SnapPagerPage(props: SnapPagerPageProps) {
  const controller = useSnapPager();
  return (
    <div
      class={`snap-pager-page ${props.class ?? ''}`}
      style={{
        left: `calc(${1000 + props.page.position() - controller.trackOrigin()} * 100% / 2001)`,
        // Adjacent pages stay fully laid out throughout a swipe. Far recycled
        // slots retain their DOM without forcing an invisible subtree layout.
        'content-visibility':
          Math.abs(props.page.position() - controller.fractionalPosition()) > 2
            ? 'hidden'
            : 'visible',
      }}
      aria-hidden={props.page.key !== controller.activePage()}
      inert={props.inert ?? props.page.key !== controller.activePage()}
    >
      {props.children}
    </div>
  );
}

export const SnapPager = {
  Root: SnapPagerRoot,
  Viewport: SnapPagerViewport,
  Page: SnapPagerPage,
};
