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

// A missing scrollend must not strand the ring; require observed stillness.
const SNAP_SETTLE_DELAY_MS = 350;
// Repeated controls jump to their aggregate target instead of replaying slides.
const SNAP_RAPID_PRESS_MS = 180;
const SNAP_NO_SCROLL_RECOVERY_MS = 150;
// Match the shared Pager's ease-out curve, with a short explicit duration.
const SNAP_ANIMATION_MS = 140;
const snapEase = (progress: number) => {
  // Invert the Bezier x-coordinate before evaluating y: (0.22, 1, 0.36, 1).
  let low = 0;
  let high = 1;
  for (let step = 0; step < 16; step++) {
    const t = (low + high) / 2;
    const x =
      3 * (1 - t) ** 2 * t * 0.22 + 3 * (1 - t) * t ** 2 * 0.36 + t ** 3;
    if (x < progress) low = t;
    else high = t;
  }
  return 1 - (1 - (low + high) / 2) ** 3;
};

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
  /** Data-only lookahead when a visible page is within two slots of an edge. */
  onNearEdge?: (position: number) => void;
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
  let animationFrame: number | undefined;
  let nativeFrame: number | undefined;
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
  // Unlock targets the committed page, not a hidden viewport's clamped offset.
  let unlockAlignmentPending = false;
  let releaseVelocity = 0;
  let scrollObserved = false;
  let sample = { left: 0, at: 0, velocity: 0 };
  let lastNearEdgePosition: number | undefined;
  const reportNearEdge = () => {
    if (!attached?.clientWidth || !options.onNearEdge) return;
    const distance = attached.scrollLeft / attached.clientWidth - middle;
    // Prepare the page entering the viewport, not only the page past halfway.
    const offset = Math.sign(distance) * Math.ceil(Math.abs(distance));
    if (offset === 0 || middle - Math.abs(offset) > 2) return;
    const visible = position() + Math.max(-middle, Math.min(middle, offset));
    if (visible === lastNearEdgePosition) return;
    lastNearEdgePosition = visible;
    options.onNearEdge(visible);
  };
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
    lastNearEdgePosition = undefined;
    options.onSettle?.(moved);
  };
  const cancelNavigation = (preserveGesture = false) => {
    const hadNavigation = pending !== 0 || queuedJump !== undefined;
    const gesture = {
      nativeScroll,
      releaseVelocity,
      scrollObserved,
      sample,
    };
    clearMotion();
    if (preserveGesture)
      ({ nativeScroll, releaseVelocity, scrollObserved, sample } = gesture);
    if (hadNavigation) options.onNavigationCancel?.();
  };
  const gestureHeld = () => touchHeld || pointerHeld;

  const clearNativeWatch = () => {
    if (nativeFrame !== undefined) cancelAnimationFrame(nativeFrame);
    nativeFrame = undefined;
  };
  const watchNativeEnd = (quietMs = SNAP_SETTLE_DELAY_MS) => {
    clearNativeWatch();
    const element = attached;
    if (!element || gestureHeld() || locked() || programmaticAnimating) return;
    let left = element.scrollLeft;
    let stillSince = Date.now();
    // WebKit can move the compositor without dispatching scroll/scrollend.
    // Sample actual position, and never write or recycle until it stays still.
    const observe = () => {
      nativeFrame = undefined;
      if (
        attached !== element ||
        gestureHeld() ||
        locked() ||
        programmaticAnimating
      )
        return;
      reportNearEdge();
      if (element.scrollLeft !== left) {
        left = element.scrollLeft;
        stillSince = Date.now();
        quietMs = SNAP_SETTLE_DELAY_MS;
      }
      if (Date.now() - stillSince >= quietMs) {
        settle();
        return;
      }
      nativeFrame = requestAnimationFrame(observe);
    };
    nativeFrame = requestAnimationFrame(observe);
  };
  const scheduleSettle = () => {
    clearTimer();
    if (nativeScroll || (scrollObserved && !rapidNavigation)) {
      watchNativeEnd();
      return;
    }
    timer = setTimeout(
      settle,
      rapidNavigation ? rapidPressMs() : SNAP_SETTLE_DELAY_MS
    );
  };
  const finishGesture = () => {
    captureRelease();
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
      if (attached !== element || gestureHeld() || scrollObserved) return;
      if (element.scrollLeft !== left) {
        // The compositor moved without a scroll event. Keep native ownership
        // and observe its actual position until momentum stops.
        watchNativeEnd();
        return;
      }
      nativeScroll = false;
      rapidNavigation = false;
      recoveredWithoutScroll = true;
      settle();
    }, SNAP_NO_SCROLL_RECOVERY_MS);
  };
  // These passive lifecycle listeners never drive scrolling. They only prevent
  // a fallback timer from recycling pages beneath a finger that stopped moving.
  const touchStart = () => {
    // Additional fingers belong to the held gesture, not a new navigation.
    if (touchHeld) return;
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

  const cancelAnimation = () => {
    if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
    animationFrame = undefined;
    programmaticAnimating = false;
  };

  const animateTo = (element: HTMLDivElement, target: number) => {
    cancelAnimation();
    clearNativeWatch();
    if (!element.clientWidth) return;
    const start = element.scrollLeft;
    const reduced = window.matchMedia?.(
      '(prefers-reduced-motion: reduce)'
    ).matches;
    element.style.scrollSnapType = 'none';
    if (reduced || Math.abs(target - start) < 1) {
      element.scrollLeft = target;
      settle();
      return;
    }
    const startedAt = Date.now();
    programmaticAnimating = true;
    const advance = () => {
      if (!element.clientWidth) {
        animationFrame = undefined;
        programmaticAnimating = false;
        return;
      }
      const progress = Math.min(
        1,
        (Date.now() - startedAt) / SNAP_ANIMATION_MS
      );
      element.scrollLeft = start + (target - start) * snapEase(progress);
      if (progress < 1) {
        animationFrame = requestAnimationFrame(advance);
        return;
      }
      animationFrame = undefined;
      element.scrollLeft = target;
      programmaticAnimating = false;
      // Own animation completion; Safari need not emit scrollend for these writes.
      settle();
    };
    animationFrame = requestAnimationFrame(advance);
  };
  // Full teardown is shared; gesture cancellation and aggregate jumps retain only
  // their explicitly captured state, never a stale destination or alignment.
  const clearMotion = () => {
    clearTimer();
    clearNativeWatch();
    clearNoScrollTimer();
    clearFrame();
    cancelAnimation();
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
    unlockAlignmentPending = false;
    scrollObserved = false;
    lastNearEdgePosition = undefined;
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
        animateTo(element, middle * element.clientWidth);
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
    setPhase('scrolling');
    animateTo(element, (middle + delta) * element.clientWidth);
  };

  const settle = () => {
    clearTimer();
    const element = attached;
    if (!element || locked() || gestureHeld() || !element.clientWidth) return;
    if (programmaticAnimating) return;
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
      animateTo(element, targetLeft);
      return;
    }
    alignmentTarget = undefined;
    unlockAlignmentPending = false;
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
    if (!attached || !width || gestureHeld()) return false;
    if (unlockAlignmentPending) {
      if (nativeScroll) watchNativeEnd();
      else animateTo(attached, middle * width);
      return true;
    }
    if (nativeScroll) return false;
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
      return unlockAlignmentPending && width > 0
        ? realignAfterResize(width)
        : false;
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
    if (programmaticAnimating) return;
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
    reportNearEdge();
    scrollObserved = true;
    if (nativeScroll && gestureHeld() && !unlockAlignmentPending) {
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
      !unlockAlignmentPending &&
      queuedJump !== undefined &&
      attached?.scrollLeft !== queuedAtScrollLeft
    )
      cancelNavigation(true);
    setPhase('scrolling');
    clearTimer();
    scheduleSettle();
  };
  const onScrollEnd = () => {
    if (programmaticAnimating) return;
    clearNoScrollTimer();
    clearNativeWatch();
    if (recoverResize()) return;
    // A completion delivered during a later held touch can belong to an old slide.
    // Release must observe this gesture's own stop instead of trusting that event.
    if (gestureHeld()) return;
    if (nativeScroll) {
      // A queued completion can predate this gesture. Confirm two still frames;
      // any continuing movement returns to the full native quiet interval.
      watchNativeEnd(32);
    } else settle();
  };

  const canStep = () =>
    !locked() &&
    !programmaticAnimating &&
    (!options.discrete?.() ||
      (!nativeScroll && !gestureHeld() && alignmentTarget === undefined));
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
    unlockAlignmentPending = false;
    alignmentTarget = undefined;
    if (rapid || animating || Math.abs(pending) > middle) {
      clearTimer();
      rapidNavigation = rapid || Boolean(animating);
      performJump(target, rapidNavigation);
      return;
    }
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
          // The lock cancelled the request, not committed the partial viewport.
          unlockAlignmentPending = true;
          alignmentTarget = 0;
          setPhase('scrolling');
          nativeScroll = gestureHeld();
          if (!gestureHeld())
            animateTo(attached, middle * attached.clientWidth);
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
