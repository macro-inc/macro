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
import { createStore } from 'solid-js/store';
import './snap-pager.css';

// Wait beyond brief momentum pauses before recycling a native scroll track.
export const SNAP_SETTLE_DELAY_MS = 180;
// Repeated controls jump to their aggregate target instead of replaying slides.
export const SNAP_RAPID_PRESS_MS = 180;

type SnapPagerPhase = 'idle' | 'scrolling' | 'settling';
interface PagerState {
  origin: number;
  position: number;
  phase: SnapPagerPhase;
  locked: boolean;
}

export interface SnapPage {
  /** Stable identity for a mounted page. */
  key: number;
  /** Its absolute slot; only a recycled page changes slots. */
  position: Accessor<number>;
  /** Its offset from the active page. */
  offset: Accessor<number>;
}

export interface SnapPagerOptions {
  /** Odd ring size, at least three. Defaults to five. */
  pageCount?: number;
  /** Called after the ring rotates; receives the number of pages traversed. */
  onSettle?: (moved: number) => void;
  /** A later gesture superseded a pending programmatic request. */
  onNavigationCancel?: () => void;
}

export interface SnapPagerController {
  pages: Accessor<readonly SnapPage[]>;
  pageOrder: Accessor<readonly number[]>;
  activePage: Accessor<number>;
  /** Total logical displacement since reset. */
  position: Accessor<number>;
  /** Accumulated command destination, including a pending native gesture request. */
  targetPosition: () => number;
  phase: Accessor<SnapPagerPhase>;
  viewport: Accessor<HTMLDivElement | undefined>;
  attachViewport: (element: HTMLDivElement) => () => void;
  next: () => void;
  previous: () => void;
  /** Relative to the committed position; pending commands accumulate. */
  goTo: (offset: number) => void;
  reset: () => void;
  setLocked: (locked: boolean) => void;
  locked: Accessor<boolean>;
  resize: () => void;
  /** Origin shared by all pages; page-specific slots remain stable. */
  origin: Accessor<number>;
}

/** Creates an endless native scroll-snap ring without replacing page nodes. */
export function createSnapPager(
  options: SnapPagerOptions = {}
): SnapPagerController {
  const count = options.pageCount ?? 5;
  if (!Number.isInteger(count) || count < 3 || count % 2 === 0) {
    throw new RangeError('SnapPager pageCount must be odd and at least three');
  }

  const middle = Math.floor(count / 2);
  const [order, setOrder] = createSignal<readonly number[]>(
    Array.from({ length: count }, (_, index) => index)
  );
  const [state, setState] = createStore<PagerState>({
    origin: 0,
    position: 0,
    phase: 'idle',
    locked: false,
  });
  const origin = () => state.origin;
  const position = () => state.position;
  const phase = () => state.phase;
  const locked = () => state.locked;
  const setOrigin = (value: number | ((previous: number) => number)) =>
    setState('origin', value);
  const setPosition = (value: number | ((previous: number) => number)) =>
    setState('position', value);
  const setPhase = (value: SnapPagerPhase) => setState('phase', value);
  const setLocked = (value: boolean) => setState('locked', value);
  const [viewport, setViewport] = createSignal<HTMLDivElement>();
  const slots = Array.from({ length: count }, (_, index) =>
    createSignal(index)
  );
  const pages: readonly SnapPage[] = slots.map(([slot], key) => ({
    key,
    position: slot,
    offset: () => slot() - origin() - middle,
  }));
  let pending = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let frame: number | undefined;
  let attached: HTMLDivElement | undefined;
  let touchHeld = false;
  let pointerHeld = false;
  let nativeScroll = false;
  let queuedJump: number | undefined;
  let queuedAtScrollLeft: number | undefined;
  let lastCommandAt: number | undefined;
  let rapidNavigation = false;
  let unreportedMovement = 0;
  const reportSettle = () => {
    const moved = unreportedMovement;
    unreportedMovement = 0;
    options.onSettle?.(moved);
  };
  const cancelNavigation = () => {
    lastCommandAt = undefined;
    rapidNavigation = false;
    if (unreportedMovement !== 0) reportSettle();
    if (pending === 0 && queuedJump === undefined) return;
    pending = 0;
    queuedJump = undefined;
    queuedAtScrollLeft = undefined;
    options.onNavigationCancel?.();
  };
  const gestureHeld = () => touchHeld || pointerHeld;

  const scheduleSettle = () => {
    clearTimer();
    timer = setTimeout(settle, SNAP_SETTLE_DELAY_MS);
  };
  // These passive lifecycle listeners never drive scrolling. They only prevent
  // a fallback timer from recycling pages beneath a finger that stopped moving.
  const touchStart = () => {
    touchHeld = true;
    nativeScroll = true;
    cancelNavigation();
    clearTimer();
  };
  const touchEnd = (event: TouchEvent) => {
    if (event.touches.length > 0) return;
    touchHeld = false;
    scheduleSettle();
  };
  const pointerStart = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    pointerHeld = true;
    nativeScroll = true;
    cancelNavigation();
    clearTimer();
  };
  const pointerEnd = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    pointerHeld = false;
    scheduleSettle();
  };
  const onWheel = (event: WheelEvent) => {
    if (locked() || (event.deltaX === 0 && !event.shiftKey)) return;
    // Trackpads have no held pointer lifecycle. New horizontal input takes
    // ownership away from a button burst without interrupting native momentum.
    if (!nativeScroll) cancelNavigation();
    nativeScroll = true;
    setPhase('scrolling');
    scheduleSettle();
  };
  const performJump = (target: number, deferReport = false) => {
    const moved = target - position();
    nativeScroll = false;
    pending = 0;
    queuedJump = undefined;
    queuedAtScrollLeft = undefined;
    rotate(moved);
    if (attached) jump(attached, middle * attached.clientWidth);
    setPhase(deferReport ? 'scrolling' : 'idle');
    if (deferReport) scheduleSettle();
    else reportSettle();
  };

  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const clearFrame = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
  };

  const jump = (element: HTMLDivElement, left: number) => {
    element.style.scrollSnapType = 'none';
    element.scrollTo({ left, behavior: 'instant' });
    clearFrame();
    frame = requestAnimationFrame(() => {
      frame = undefined;
      if (!locked()) element.style.scrollSnapType = '';
    });
  };

  const rotate = (moved: number) => {
    if (moved === 0) return;
    // Move only the slots that cross an edge. Shift the shared origin to keep
    // every other page node in place when the viewport returns to the middle.
    const steps = Math.abs(moved) % count;
    const direction = Math.sign(moved);
    batch(() => {
      for (let index = 0; index < steps; index++) {
        const current = order();
        const recycled = direction > 0 ? current[0] : current[count - 1];
        const [, setSlot] = slots[recycled];
        setSlot((slot) => slot + direction * count);
        setOrder(
          direction > 0
            ? [...current.slice(1), recycled]
            : [recycled, ...current.slice(0, -1)]
        );
      }
      setOrigin((value) => value + direction * steps);
      setPosition((value) => value + moved);
    });
    unreportedMovement += moved;
  };

  const navigate = () => {
    const element = attached;
    if (locked()) return;
    if (pending === 0) {
      if (element && phase() === 'scrolling') {
        const reduced =
          window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ??
          false;
        element.scrollTo({
          left: middle * element.clientWidth,
          behavior: reduced ? 'instant' : 'smooth',
        });
      }
      return;
    }
    if (!element || !element.clientWidth) {
      const moved = pending;
      pending = 0;
      rotate(moved);
      setPhase('idle');
      reportSettle();
      return;
    }
    const delta = Math.max(-middle, Math.min(middle, pending));
    const reducedMotion =
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    setPhase('scrolling');
    element.scrollTo({
      left: (middle + delta) * element.clientWidth,
      behavior: reducedMotion ? 'instant' : 'smooth',
    });
    // Instant scrolling does not always emit scrollend or even scroll.
    if (reducedMotion) {
      clearTimer();
      timer = setTimeout(settle, 0);
    }
  };

  const settle = () => {
    clearTimer();
    const element = attached;
    if (!element || locked() || gestureHeld() || !element.clientWidth) return;
    // A burst changes the visible target immediately but prepares data only once
    // controls go quiet. Ignore synthetic scrollend events from each re-centre.
    if (rapidNavigation && lastCommandAt !== undefined) {
      const remaining = SNAP_RAPID_PRESS_MS - (Date.now() - lastCommandAt);
      if (remaining > 0) {
        timer = setTimeout(settle, remaining);
        return;
      }
    }
    rapidNavigation = false;
    nativeScroll = false;
    const hadMovement = phase() !== 'idle' || pending !== 0;
    const moved = Math.max(
      -middle,
      Math.min(
        middle,
        Math.round(element.scrollLeft / element.clientWidth) - middle
      )
    );
    if (moved === 0) {
      pending = 0;
      setPhase('idle');
      if (queuedJump !== undefined) performJump(queuedJump);
      else if (hadMovement || unreportedMovement !== 0) reportSettle();
      return;
    }
    setPhase('settling');
    rotate(moved);
    if (pending !== 0) pending -= moved;
    jump(element, middle * element.clientWidth);
    setPhase('idle');
    if (queuedJump !== undefined) performJump(queuedJump);
    else if (pending !== 0) navigate();
    else reportSettle();
  };

  const onScroll = () => {
    if (locked()) return;
    if (
      phase() === 'idle' &&
      attached &&
      attached.scrollLeft === middle * attached.clientWidth
    )
      return;
    if (phase() === 'idle' && pending === 0) nativeScroll = true;
    if (
      gestureHeld() &&
      queuedJump !== undefined &&
      attached?.scrollLeft !== queuedAtScrollLeft
    )
      cancelNavigation();
    setPhase('scrolling');
    clearTimer();
    scheduleSettle();
  };
  const onScrollEnd = () => settle();

  const command = (offset: number) => {
    if (locked() || !Number.isInteger(offset) || offset === 0) return;
    const now = Date.now();
    const rapid =
      lastCommandAt !== undefined && now - lastCommandAt < SNAP_RAPID_PRESS_MS;
    lastCommandAt = now;
    const target = (queuedJump ?? position() + pending) + offset;
    // Never re-centre a native gesture under the user's finger or momentum.
    // Programmatic slides, in contrast, can be retargeted immediately.
    if (gestureHeld() || nativeScroll) {
      queuedJump = target;
      queuedAtScrollLeft = attached?.scrollLeft;
      rapidNavigation = rapid;
      return;
    }
    pending = target - position();
    if (rapid || Math.abs(pending) > middle) {
      clearTimer();
      rapidNavigation = rapid;
      performJump(target, rapid);
      return;
    }
    navigate();
  };
  const detach = (element: HTMLDivElement) => {
    element.removeEventListener('scroll', onScroll);
    element.removeEventListener('scrollend', onScrollEnd);
    element.removeEventListener('touchstart', touchStart);
    element.removeEventListener('wheel', onWheel);
    element.removeEventListener('pointerdown', pointerStart);
    if (attached !== element) return;
    window.removeEventListener('touchend', touchEnd);
    window.removeEventListener('touchcancel', touchEnd);
    window.removeEventListener('pointerup', pointerEnd);
    window.removeEventListener('pointercancel', pointerEnd);
    touchHeld = false;
    pointerHeld = false;
    nativeScroll = false;
    element.style.scrollSnapType = '';
    clearTimer();
    clearFrame();
    if (attached === element) {
      attached = undefined;
      setViewport(undefined);
      setPhase('idle');
    }
  };

  return {
    pages: () => pages,
    pageOrder: order,
    activePage: () => order()[middle],
    position,
    targetPosition: () => queuedJump ?? position() + pending,
    phase,
    viewport,
    origin,
    locked,
    attachViewport(element) {
      if (attached) detach(attached);
      attached = element;
      setViewport(element);
      element.addEventListener('wheel', onWheel, { passive: true });
      element.addEventListener('scroll', onScroll);
      element.addEventListener('scrollend', onScrollEnd);
      element.addEventListener('touchstart', touchStart, { passive: true });
      element.addEventListener('pointerdown', pointerStart, { passive: true });
      window.addEventListener('touchend', touchEnd, { passive: true });
      window.addEventListener('touchcancel', touchEnd, { passive: true });
      window.addEventListener('pointerup', pointerEnd, { passive: true });
      window.addEventListener('pointercancel', pointerEnd, { passive: true });
      jump(element, middle * element.clientWidth);
      return () => detach(element);
    },
    next: () => command(1),
    previous: () => command(-1),
    goTo: command,
    reset() {
      clearTimer();
      pending = 0;
      queuedJump = undefined;
      lastCommandAt = undefined;
      rapidNavigation = false;
      nativeScroll = false;
      unreportedMovement = 0;
      batch(() => {
        slots.forEach(([, setSlot], index) => setSlot(index));
        setOrigin(0);
        setOrder(Array.from({ length: count }, (_, index) => index));
        setPosition(0);
        setPhase('idle');
      });
      if (attached) jump(attached, middle * attached.clientWidth);
    },
    setLocked(value) {
      if (value === locked()) return;
      if (value) cancelNavigation();
      nativeScroll = false;
      pending = 0;
      queuedJump = undefined;
      clearTimer();
      setLocked(value);
      if (attached) {
        if (value) {
          // Cancel native smooth scrolling without committing a partial gesture.
          const left = attached.scrollLeft;
          attached.style.scrollSnapType = 'none';
          attached.scrollTo({ left, behavior: 'instant' });
        } else {
          attached.style.scrollSnapType = '';
          settle();
        }
      }
      if (value) setPhase('idle');
    },
    resize() {
      if (!attached || gestureHeld() || (phase() !== 'idle' && !locked()))
        return;
      jump(attached, middle * attached.clientWidth);
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
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === width) return;
      width = element.clientWidth;
      // A locked resize keeps the same page; an active fling settles naturally.
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
      data-phase={controller.phase()}
    >
      <div
        class="snap-pager-rail"
        style={{ '--snap-origin': controller.origin() }}
      >
        {local.children}
      </div>
    </div>
  );
}

export type SnapPagerPageProps = ParentProps<{
  page: SnapPage;
  class?: string;
}>;

export function SnapPagerPage(props: SnapPagerPageProps) {
  const controller = useSnapPager();
  return (
    <div
      class={`snap-pager-page ${props.class ?? ''}`}
      style={{ '--snap-page-position': props.page.position() }}
      aria-hidden={props.page.key !== controller.activePage()}
      inert={props.page.key !== controller.activePage()}
    >
      {props.children}
    </div>
  );
}
