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
import { settleTarget } from './settle-target';

// Only older engines without scrollend use a quiet-time fallback.
const SNAP_SETTLE_DELAY_MS = 350;
// Repeated controls jump to their aggregate target instead of replaying slides.
const SNAP_RAPID_PRESS_MS = 180;
const SNAP_NO_SCROLL_RECOVERY_MS = 150;

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

export type SnapPagerOptions = {
  /** Odd ring size, at least three. Defaults to five. */
  pageCount?: number;
  /** Called after the ring rotates; receives the number of pages traversed. */
  onSettle?: (moved: number) => void;
  /** A later gesture superseded a pending programmatic request. */
  onNavigationCancel?: () => void;
  /** Pause caller-owned render work before native scrolling begins. */
  onScrollStart?: () => void;
  /** Discrete desktop navigation; other hosts keep native touch scrolling. */
  discrete?: Accessor<boolean>;
  /** Update host navigation metadata before a discrete wheel jump. */
  onWheelNavigate?: (direction: number) => void;
};

export type SnapPagerController = {
  pages: Accessor<readonly SnapPage[]>;
  pageOrder: Accessor<readonly number[]>;
  activePage: Accessor<number>;
  /** Total logical displacement since reset. */
  position: Accessor<number>;
  /** Accumulated command destination, including a pending native gesture request. */
  targetPosition: () => number;
  phase: Accessor<SnapPagerPhase>;
  /** Desktop period buttons ignore active animation, but accept idle burst steps. */
  canStep: () => boolean;
  attachViewport: (element: HTMLDivElement) => () => void;
  next: () => void;
  previous: () => void;
  /** Relative to the committed position; pending commands accumulate. */
  goTo: (offset: number) => void;
  reset: () => void;
  setLocked: (locked: boolean) => void;
  locked: Accessor<boolean>;
  discrete: Accessor<boolean>;
  resize: () => void;
  /** Origin shared by all pages; page-specific slots remain stable. */
  origin: Accessor<number>;
};

/** Creates an endless native scroll-snap ring without replacing page nodes. */
export function createSnapPager(
  options: SnapPagerOptions = {}
): SnapPagerController {
  const count = options.pageCount ?? 5;
  const rapidPressMs = () => (options.discrete?.() ? 300 : SNAP_RAPID_PRESS_MS);
  let wheelLastAt: number | undefined;
  let programmaticAnimating = false;
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
  let noScrollTimer: ReturnType<typeof setTimeout> | undefined;
  let recoveredWithoutScroll = false;
  let attached: HTMLDivElement | undefined;
  let measuredWidth = 0;
  let touchHeld = false;
  let pointerHeld = false;
  let nativeScroll = false;
  let queuedJump: number | undefined;
  let queuedAtScrollLeft: number | undefined;
  let lastCommandAt: number | undefined;
  let rapidNavigation = false;
  let unreportedMovement = 0;
  let alignmentTarget: number | undefined;
  let releaseVelocity = 0;
  let scrollObserved = false;
  let nativeEndedWhileHeld = false;
  let sample = { left: 0, at: 0, velocity: 0 };
  const beginNativeScroll = () => {
    clearNoScrollTimer();
    if (locked()) return;
    recoveredWithoutScroll = false;
    if (nativeScroll && alignmentTarget === undefined) return;
    setPhase('scrolling');
    cancelNavigation();
    nativeScroll = true;
    sample = { left: attached?.scrollLeft ?? 0, at: Date.now(), velocity: 0 };
    if (attached) attached.style.scrollSnapType = 'none';
    options.onScrollStart?.();
  };
  const captureRelease = () => {
    releaseVelocity = Date.now() - sample.at <= 80 ? sample.velocity : 0;
  };
  const reportSettle = () => {
    const moved = unreportedMovement;
    unreportedMovement = 0;
    options.onSettle?.(moved);
  };
  const cancelNavigation = (preserveGesture = false) => {
    const hadNavigation = pending !== 0 || queuedJump !== undefined;
    const gesture = {
      nativeScroll,
      releaseVelocity,
      scrollObserved,
      nativeEndedWhileHeld,
      sample,
    };
    clearMotion();
    if (preserveGesture)
      ({
        nativeScroll,
        releaseVelocity,
        scrollObserved,
        nativeEndedWhileHeld,
        sample,
      } = gesture);
    if (hadNavigation) options.onNavigationCancel?.();
  };
  const gestureHeld = () => touchHeld || pointerHeld;

  const scheduleSettle = () => {
    clearTimer();
    if (
      attached &&
      'onscrollend' in attached &&
      scrollObserved &&
      (nativeScroll || !rapidNavigation)
    )
      return;
    timer = setTimeout(
      settle,
      rapidNavigation && !nativeScroll ? rapidPressMs() : SNAP_SETTLE_DELAY_MS
    );
  };
  const finishGesture = () => {
    captureRelease();
    if (nativeEndedWhileHeld) {
      settle();
      return;
    }
    if (scrollObserved || (attached && attached.scrollLeft !== sample.left)) {
      scrollObserved = true;
      scheduleSettle();
      return;
    }
    clearTimer();
    clearNoScrollTimer();
    const element = attached;
    if (!element) return;
    const left = element.scrollLeft;
    // No-op gestures need not emit scrollend. Recover only after a bounded
    // interval with no scroll event and no position change; late scrolling
    // takes native ownership back before any further command can run.
    noScrollTimer = setTimeout(() => {
      noScrollTimer = undefined;
      if (
        attached !== element ||
        gestureHeld() ||
        scrollObserved ||
        element?.scrollLeft !== left
      )
        return;
      nativeScroll = false;
      rapidNavigation = false;
      recoveredWithoutScroll = true;
      settle();
    }, SNAP_NO_SCROLL_RECOVERY_MS);
  };
  // These passive lifecycle listeners never drive scrolling. They only prevent
  // a fallback timer from recycling pages beneath a finger that stopped moving.
  const touchStart = () => {
    touchHeld = true;
    beginNativeScroll();
    clearTimer();
  };
  const touchEnd = (event: TouchEvent) => {
    if (!touchHeld || event.touches.length > 0) return;
    touchHeld = false;
    finishGesture();
  };
  const pointerStart = (event: PointerEvent) => {
    if (event.pointerType === 'touch' || options.discrete?.()) return;
    pointerHeld = true;
    beginNativeScroll();
    clearTimer();
  };
  const pointerEnd = (event: PointerEvent) => {
    if (!pointerHeld || event.pointerType === 'touch') return;
    pointerHeld = false;
    finishGesture();
  };
  const onWheel = (event: WheelEvent) => {
    if (options.discrete?.()) {
      const horizontal = Math.abs(event.deltaX);
      if (event.ctrlKey || horizontal <= Math.abs(event.deltaY)) return;
      const now = Date.now();
      const inBurst =
        wheelLastAt !== undefined && now - wheelLastAt < SNAP_RAPID_PRESS_MS;
      if (horizontal < 4 && !inBurst) return;
      event.preventDefault();
      if (locked()) return;
      wheelLastAt = now;
      if (!inBurst) {
        const target =
          (queuedJump ?? position() + pending) + Math.sign(event.deltaX);
        clearTimer();
        clearNoScrollTimer();
        options.onScrollStart?.();
        options.onWheelNavigate?.(Math.sign(event.deltaX));
        alignmentTarget = undefined;
        lastCommandAt = now;
        rapidNavigation = true;
        performJump(target, true);
      } else {
        lastCommandAt = now;
        scheduleSettle();
      }
      return;
    }
    if (locked() || (event.deltaX === 0 && !event.shiftKey)) return;
    // Phone and other hosts retain native momentum until scrollend.
    beginNativeScroll();
    scheduleSettle();
  };
  const performJump = (target: number, deferReport = false) => {
    const moved = target - position();
    const command = {
      lastCommandAt,
      wheelLastAt,
      rapidNavigation,
      recoveredWithoutScroll,
    };
    clearMotion();
    ({ lastCommandAt, wheelLastAt, rapidNavigation, recoveredWithoutScroll } =
      command);
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

  const clearNoScrollTimer = () => {
    if (noScrollTimer !== undefined) clearTimeout(noScrollTimer);
    noScrollTimer = undefined;
  };

  const clearFrame = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
  };

  // Full teardown is shared; gesture cancellation and aggregate jumps retain only
  // their explicitly captured state, never a stale destination or alignment.
  const clearMotion = () => {
    clearTimer();
    clearNoScrollTimer();
    clearFrame();
    programmaticAnimating = false;
    recoveredWithoutScroll = false;
    pending = 0;
    queuedJump = undefined;
    queuedAtScrollLeft = undefined;
    lastCommandAt = undefined;
    wheelLastAt = undefined;
    rapidNavigation = false;
    nativeScroll = false;
    alignmentTarget = undefined;
    releaseVelocity = 0;
    scrollObserved = false;
    nativeEndedWhileHeld = false;
    sample = { left: 0, at: 0, velocity: 0 };
  };

  const jump = (element: HTMLDivElement, left: number) => {
    element.style.scrollSnapType = 'none';
    element.scrollLeft = left;
    clearFrame();
    frame = requestAnimationFrame(() => {
      frame = undefined;
      if (!locked() && !nativeScroll && !gestureHeld())
        element.style.scrollSnapType = '';
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
        if (reduced) element.scrollLeft = middle * element.clientWidth;
        else
          element.scrollTo({
            left: middle * element.clientWidth,
            behavior: 'smooth',
          });
      }
      return;
    }
    if (element && !element.clientWidth) return;
    if (!element) {
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
    programmaticAnimating = !reducedMotion;
    if (reducedMotion)
      element.scrollLeft = (middle + delta) * element.clientWidth;
    else
      element.scrollTo({
        left: (middle + delta) * element.clientWidth,
        behavior: 'smooth',
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
    if (
      options.discrete?.() &&
      programmaticAnimating &&
      'onscrollend' in element
    )
      return;
    // A burst changes the visible target immediately but prepares data only once
    // controls go quiet. Ignore synthetic scrollend events from each re-centre.
    if (rapidNavigation && lastCommandAt !== undefined) {
      const remaining = rapidPressMs() - (Date.now() - lastCommandAt);
      if (remaining > 0) {
        timer = setTimeout(settle, remaining);
        return;
      }
    }
    rapidNavigation = false;
    const hadMovement = phase() !== 'idle' || pending !== 0;
    const moved =
      alignmentTarget ??
      settleTarget({
        distance: element.scrollLeft - middle * element.clientWidth,
        width: element.clientWidth,
        releaseVelocity,
        maxPages: middle,
      });
    // Native momentum has ended. Align smoothly first, then recycle on the
    // alignment's scrollend. Never round and jump a partially visible page.
    const targetLeft = (middle + moved) * element.clientWidth;
    if (Math.abs(element.scrollLeft - targetLeft) > 1) {
      alignmentTarget = moved;
      setPhase('settling');
      const reduced =
        window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ??
        false;
      if (reduced) element.scrollLeft = targetLeft;
      else element.scrollTo({ left: targetLeft, behavior: 'smooth' });
      if (reduced) settle();
      else scheduleSettle();
      return;
    }
    alignmentTarget = undefined;
    releaseVelocity = 0;
    nativeScroll = false;
    if (moved === 0) {
      pending = 0;
      setPhase('idle');
      element.style.scrollSnapType = '';
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

  const realignAfterResize = (width: number) => {
    if (!attached || gestureHeld() || nativeScroll) return false;
    if (pending !== 0) {
      // Keep the logical destination even if the old smooth scroll ends late.
      alignmentTarget = Math.max(-middle, Math.min(middle, pending));
      navigate();
      return true;
    }
    if (phase() !== 'idle' && !locked()) return false;
    jump(attached, middle * width);
    return true;
  };
  const recoverResize = () => {
    if (!attached) return false;
    const width = attached.clientWidth;
    if (!measuredWidth) {
      measuredWidth = width;
      return false;
    }
    if (width === measuredWidth) return false;
    measuredWidth = width;
    // A resize can emit scroll before ResizeObserver measures the new width.
    // Re-center a committed page before treating that scroll as a gesture.
    return realignAfterResize(width);
  };
  const onScroll = () => {
    clearNoScrollTimer();
    if (recoverResize()) return;
    if (locked()) return;
    if (
      recoveredWithoutScroll &&
      attached &&
      attached.scrollLeft !== middle * attached.clientWidth
    ) {
      recoveredWithoutScroll = false;
      beginNativeScroll();
    }
    if (
      phase() === 'idle' &&
      attached &&
      attached.scrollLeft === middle * attached.clientWidth
    )
      return;
    if (phase() === 'idle' && pending === 0) beginNativeScroll();
    scrollObserved = true;
    nativeEndedWhileHeld = false;
    if (nativeScroll && gestureHeld()) {
      const now = Date.now();
      const left = attached?.scrollLeft ?? 0;
      const elapsed = now - sample.at;
      sample = {
        left,
        at: now,
        velocity: elapsed > 0 ? (left - sample.left) / elapsed : 0,
      };
    }
    if (
      gestureHeld() &&
      queuedJump !== undefined &&
      attached?.scrollLeft !== queuedAtScrollLeft
    )
      cancelNavigation(true);
    setPhase('scrolling');
    clearTimer();
    scheduleSettle();
  };
  const onScrollEnd = () => {
    programmaticAnimating = false;
    clearNoScrollTimer();
    if (recoverResize()) return;
    if (gestureHeld()) {
      nativeEndedWhileHeld = true;
      return;
    }
    settle();
  };

  const canStep = () =>
    !locked() &&
    (!options.discrete?.() ||
      (!programmaticAnimating &&
        !nativeScroll &&
        !gestureHeld() &&
        alignmentTarget === undefined));
  const command = (offset: number) => {
    if (locked() || !Number.isInteger(offset) || offset === 0) return;
    const now = Date.now();
    const rapid =
      lastCommandAt !== undefined && now - lastCommandAt < rapidPressMs();
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
    const animating =
      options.discrete?.() && phase() !== 'idle' && pending !== 0;
    pending = target - position();
    alignmentTarget = undefined;
    if (rapid || animating || Math.abs(pending) > middle) {
      clearTimer();
      rapidNavigation = rapid || Boolean(animating);
      performJump(target, rapidNavigation);
      return;
    }
    if (options.discrete?.()) rapidNavigation = true;
    navigate();
  };
  const detach = (element: HTMLDivElement) => {
    element.classList.remove('snap-pager-discrete');
    programmaticAnimating = false;
    element.removeEventListener('scroll', onScroll);
    element.removeEventListener('scrollend', onScrollEnd);
    element.removeEventListener('touchstart', touchStart, true);
    element.removeEventListener('wheel', onWheel);
    element.removeEventListener('pointerdown', pointerStart, true);
    if (attached !== element) return;
    window.removeEventListener('touchend', touchEnd, true);
    window.removeEventListener('touchcancel', touchEnd, true);
    window.removeEventListener('pointerup', pointerEnd, true);
    window.removeEventListener('pointercancel', pointerEnd, true);
    touchHeld = false;
    pointerHeld = false;
    clearMotion();
    element.style.scrollSnapType = '';
    if (attached === element) {
      attached = undefined;
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
    canStep,
    origin,
    locked,
    discrete: () => options.discrete?.() ?? false,
    attachViewport(element) {
      if (attached) detach(attached);
      attached = element;
      measuredWidth = element.clientWidth;
      element.addEventListener('wheel', onWheel, { passive: false });
      element.addEventListener('scroll', onScroll);
      element.addEventListener('scrollend', onScrollEnd);
      // Nested controls and sheets can consume release events. Capture both
      // ends so the ring never keeps a stale held-contact flag after dismissal.
      element.addEventListener('touchstart', touchStart, {
        passive: true,
        capture: true,
      });
      element.addEventListener('pointerdown', pointerStart, {
        passive: true,
        capture: true,
      });
      window.addEventListener('touchend', touchEnd, {
        passive: true,
        capture: true,
      });
      window.addEventListener('touchcancel', touchEnd, {
        passive: true,
        capture: true,
      });
      window.addEventListener('pointerup', pointerEnd, {
        passive: true,
        capture: true,
      });
      window.addEventListener('pointercancel', pointerEnd, {
        passive: true,
        capture: true,
      });
      jump(element, middle * element.clientWidth);
      return () => detach(element);
    },
    next: () => {
      if (canStep()) command(1);
    },
    previous: () => {
      if (canStep()) command(-1);
    },
    goTo: command,
    reset() {
      clearMotion();
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
      else clearMotion();
      setLocked(value);
      if (attached) {
        if (value) {
          // Cancel native smooth scrolling without committing a partial gesture.
          const left = attached.scrollLeft;
          attached.style.scrollSnapType = 'none';
          attached.scrollLeft = left;
        } else {
          attached.style.scrollSnapType = '';
          settle();
        }
      }
      if (value) setPhase('idle');
    },
    resize() {
      if (!attached) return;
      measuredWidth = attached.clientWidth;
      realignAfterResize(measuredWidth);
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
        'snap-pager-discrete': controller.discrete(),
      }}
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

export const SnapPager = {
  Root: SnapPagerRoot,
  Viewport: SnapPagerViewport,
  Page: SnapPagerPage,
};
