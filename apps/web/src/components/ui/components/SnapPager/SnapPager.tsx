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

const SETTLE_DELAY = 100;

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
  let queuedJump: number | undefined;
  let queuedAtScrollLeft: number | undefined;
  const cancelNavigation = () => {
    if (pending === 0 && queuedJump === undefined) return;
    pending = 0;
    queuedJump = undefined;
    queuedAtScrollLeft = undefined;
    options.onNavigationCancel?.();
  };
  const gestureHeld = () => touchHeld || pointerHeld;

  const scheduleSettle = () => {
    clearTimer();
    timer = setTimeout(settle, SETTLE_DELAY);
  };
  // These passive lifecycle listeners never drive scrolling. They only prevent
  // a fallback timer from recycling pages beneath a finger that stopped moving.
  const touchStart = () => {
    touchHeld = true;
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
    cancelNavigation();
    clearTimer();
  };
  const pointerEnd = (event: PointerEvent) => {
    if (event.pointerType === 'touch') return;
    pointerHeld = false;
    scheduleSettle();
  };
  const performJump = (target: number) => {
    const moved = target - position();
    pending = 0;
    queuedJump = undefined;
    rotate(moved);
    if (attached) jump(attached, middle * attached.clientWidth);
    setPhase('idle');
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
    options.onSettle?.(moved);
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
      else if (hadMovement) options.onSettle?.(0);
      return;
    }
    setPhase('settling');
    rotate(moved);
    if (pending !== 0) pending -= moved;
    jump(element, middle * element.clientWidth);
    setPhase('idle');
    if (queuedJump !== undefined) performJump(queuedJump);
    else if (pending !== 0) navigate();
  };

  const onScroll = () => {
    if (locked()) return;
    if (
      phase() === 'idle' &&
      attached &&
      attached.scrollLeft === middle * attached.clientWidth
    )
      return;
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

  const detach = (element: HTMLDivElement) => {
    element.removeEventListener('scroll', onScroll);
    element.removeEventListener('scrollend', onScrollEnd);
    element.removeEventListener('touchstart', touchStart);
    element.removeEventListener('pointerdown', pointerStart);
    if (attached !== element) return;
    window.removeEventListener('touchend', touchEnd);
    window.removeEventListener('touchcancel', touchEnd);
    window.removeEventListener('pointerup', pointerEnd);
    window.removeEventListener('pointercancel', pointerEnd);
    touchHeld = false;
    pointerHeld = false;
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
    phase,
    viewport,
    origin,
    locked,
    attachViewport(element) {
      if (attached) detach(attached);
      attached = element;
      setViewport(element);
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
    next() {
      if (locked()) return;
      if (queuedJump !== undefined) {
        queuedJump += 1;
        return;
      }
      pending += 1;
      navigate();
    },
    previous() {
      if (locked()) return;
      if (queuedJump !== undefined) {
        queuedJump -= 1;
        return;
      }
      pending -= 1;
      navigate();
    },
    goTo(offset) {
      if (locked() || !Number.isInteger(offset) || offset === 0) return;
      const target = position() + offset;
      if (gestureHeld() || phase() === 'scrolling') {
        queuedJump = target;
        queuedAtScrollLeft = attached?.scrollLeft;
        return;
      }
      pending = offset;
      if (Math.abs(pending) > middle) {
        clearTimer();
        performJump(target);
        return;
      }
      navigate();
    },
    reset() {
      clearTimer();
      pending = 0;
      queuedJump = undefined;
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
