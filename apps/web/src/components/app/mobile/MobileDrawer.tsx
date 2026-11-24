import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { debounce } from '@core/util/debounce';
import { isEditableInput } from '@core/util/isEditableInput';
import Dialog from '@corvu/dialog';
import Drawer from '@corvu/drawer';
import { Layer } from '@ui/components/Layer';
import { cn } from '@ui/utils/classname';
import {
  type Accessor,
  type ComponentProps,
  createContext,
  createEffect,
  createSignal,
  For,
  type JSX,
  on,
  onCleanup,
  Show,
  splitProps,
  useContext,
  type ValidComponent,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { createCloseOnNavigation } from './close-on-navigation';
import {
  nearestSnapPoint,
  type SheetMetrics,
  sheetHiddenSize,
  sheetOffset,
  sheetSnapPoints,
} from './sheet-geometry';

/** The visible fraction of a bottom sheet it rests at; 1 is fully open. */
export type DrawerSnapPoint = number;

/**
 * Call this from a scroll container's `onFocusIn` to smoothly scroll a
 * focused input/textarea to `offset` px from the container's top edge.
 *
 * Usage:
 *   <div onFocusIn={(e) => scrollToFocusedInput(e)}>
 */
let scrollTimer: ReturnType<typeof setTimeout> | undefined;

export function scrollToFocusedInput(e: FocusEvent, offset = 40) {
  if (!isEditableInput(e.target as Element) || scrollTimer !== undefined)
    return;
  const input = e.target as HTMLElement;
  const container =
    input.closest<HTMLElement>('[data-drawer-scroll-body]') ??
    (e.currentTarget as HTMLElement);
  // Has to be delayed until after browser's native keyboard-show scroll completes
  scrollTimer = setTimeout(() => {
    scrollTimer = undefined;
    const inputRect = input.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    container.scrollTo({
      top: container.scrollTop + (inputRect.top - containerRect.top) - offset,
      behavior: 'smooth',
    });
  }, 300);
}

/** Corvu's focus trap's own selector, to read the stop it would focus. */
const FOCUSABLE_SELECTOR =
  'a[href]:not([tabindex="-1"]), button:not([tabindex="-1"]), input:not([tabindex="-1"]), textarea:not([tabindex="-1"]), select:not([tabindex="-1"]), details:not([tabindex="-1"]), [tabindex]:not([tabindex="-1"])';

/** Read at the moment of a slide, so a changed preference applies at once. */
function reducedMotion() {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Quiet time after the last scroll event before a swipe counts as settled. */
const SETTLE_DELAY_MS = 180;
/** Longest a closing slide may take before the sheet unmounts anyway. */
const CLOSE_FALLBACK_MS = 650;

type ScrollSheetControls = {
  /** The owner opened the sheet while it was mounted (closing, or forced). */
  open: () => void;
  /** Slide the sheet off screen, then call `done`. */
  close: (done: () => void) => void;
};

/**
 * A bottom sheet is a native scroll container (the "Scrolling is all you
 * need" sheet): the swipe, its momentum, rubber-banding and detents are the
 * browser's own scrolling and scroll snapping, which iOS runs off the main
 * thread at the display's full refresh rate. Corvu's dialog keeps the open
 * state, focus trap, Escape and outside-pointer handling; it closes at once,
 * and the sheet stays mounted only for its closing slide.
 */
type ScrollSheetContextValue = {
  open: Accessor<boolean>;
  snapPoints: Accessor<number[]>;
  activeSnapPoint: Accessor<number>;
  setActiveSnapPoint: (point: number) => void;
  allowSkippingSnapPoints: Accessor<boolean>;
  /** How far the resting sheet sits below its fully open position, in px. */
  translate: Accessor<number>;
  setTranslate: (px: number) => void;
  /** The scrim's extra classes while an Overlay is mounted. */
  scrim: Accessor<Accessor<string | undefined> | undefined>;
  setScrim: (scrim: Accessor<string | undefined> | undefined) => void;
  /** Keeps the portal and content mounted through the closing slide. */
  keepMounted: Accessor<boolean>;
  setKeepMounted: (keep: boolean) => void;
  requestClose: () => void;
  backdropTap: (event: PointerEvent) => void;
  register: (controls: ScrollSheetControls) => () => void;
};

const ScrollSheetContext = createContext<ScrollSheetContextValue>();

function useScrollSheet() {
  const sheet = useContext(ScrollSheetContext);
  if (!sheet)
    throw new Error('A bottom sheet part must be inside a MobileDrawer.');
  return sheet;
}

type SheetContentProps = ComponentProps<typeof Dialog.Content> & {
  /**
   * False for a sheet that only closes from its own controls (Cancel, Done):
   * it opens and closes with the same slide, but a swipe doesn't move it.
   */
  swipeable?: boolean;
  /** Called each time the opening slide comes to rest. */
  onOpened?: () => void;
};

type SheetPhase = 'opening' | 'open' | 'closing' | 'closed';

/**
 * The scroll container and the sheet panel inside it. The container covers
 * the screen: a spacer the screen's height sits above the panel, so scroll
 * offset 0 is closed and the end of the range is open. Snap markers beside
 * the panel give the detents; the scrim fades with the scroll position
 * through a scroll-driven animation.
 */
function ScrollSheetFrame(
  props: SheetContentProps & {
    panelClass: string;
    panelStyle?: JSX.CSSProperties;
    /** Space below the panel: the screen-edge gutter and the keyboard. */
    gutterClass: string;
  }
) {
  const [local, rest] = splitProps(props, [
    'class',
    'style',
    'children',
    'ref',
    'panelClass',
    'panelStyle',
    'gutterClass',
    'swipeable',
    'onOpened',
    'onFocusIn',
    'forceMount',
  ]);
  const sheet = useScrollSheet();
  const dialog = Dialog.useContext();
  const [scroller, setScroller] = createSignal<HTMLDivElement>();
  let panel: HTMLDivElement | undefined;
  let gutter: HTMLDivElement | undefined;
  // A forced-mounted sheet (`forceMount`) mounts closed, and hides.
  const [phase, setPhase] = createSignal<SheetPhase>(
    dialog.open() ? 'opening' : 'closed'
  );
  let onClosed: (() => void) | undefined;
  // Only a finger may dismiss: a rest at closed reached by a programmatic
  // slide, a re-snap after layout or a focus scroll is put back instead.
  let gesture = false;
  let touching = false;
  let retargets = 0;

  const metrics = (): SheetMetrics | undefined => {
    const element = scroller();
    if (!element || !panel) return;
    const maxOffset = element.scrollHeight - element.clientHeight;
    // Unlaid-out (hidden, or a test DOM): there is nothing to slide.
    if (!panel.offsetHeight || maxOffset <= 0) return;
    return { panelSize: panel.offsetHeight, maxOffset };
  };
  const offset = () => scroller()?.scrollTop ?? 0;
  const scrollTo = (top: number, smooth: boolean) => {
    scroller()?.scrollTo({
      top,
      behavior: smooth && !reducedMotion() ? 'smooth' : 'instant',
    });
  };
  const finishOpening = () => {
    if (phase() !== 'opening') return;
    setPhase('open');
    local.onOpened?.();
  };
  const finishClosing = () => {
    const done = onClosed;
    onClosed = undefined;
    if (!done) return;
    setPhase('closed');
    done();
  };
  const closeFallback = debounce(finishClosing, CLOSE_FALLBACK_MS);

  /** Slide up to the owner's rest; from closed, start at offset 0. */
  const slideOpen = (fromClosed: boolean) => {
    // Measure once the phase change has reached the DOM: a closed
    // forced-mounted sheet is `display: none` until then.
    queueMicrotask(() => {
      if (phase() !== 'opening') return;
      if (!metrics()) {
        finishOpening();
        return;
      }
      if (fromClosed) scrollTo(0, false);
      requestAnimationFrame(() => {
        const current = metrics();
        if (phase() !== 'opening' || !current) return;
        const target = sheetOffset(current, sheet.activeSnapPoint());
        // Already there (reopened mid-close): no scroll will settle it.
        if (reducedMotion() || Math.abs(offset() - target) <= 1) {
          scrollTo(target, false);
          settle();
          return;
        }
        scrollTo(target, true);
      });
    });
  };

  /** A swipe, a slide or a re-snap has come to rest. */
  const settle = () => {
    const current = metrics();
    if (!current || touching) return;
    const point = nearestSnapPoint(current, offset(), sheet.snapPoints());
    if (phase() === 'closing') {
      if (point === 0) finishClosing();
      return;
    }
    if (phase() === 'closed') return;
    const swiped = gesture;
    gesture = false;
    if (!swiped) {
      const target = sheetOffset(current, sheet.activeSnapPoint());
      if (Math.abs(offset() - target) > 1 && retargets < 2) {
        retargets += 1;
        scrollTo(target, true);
        return;
      }
      retargets = 0;
      finishOpening();
      sheet.setTranslate(sheetHiddenSize(current, offset()));
      return;
    }
    retargets = 0;
    if (point === 0) {
      sheet.requestClose();
      // An owner that keeps the sheet open (to confirm a discard, or while an
      // action is pending) gets it back on screen at its last rest.
      queueMicrotask(() => {
        const latest = metrics();
        if (phase() === 'closing' || !sheet.open() || !latest) return;
        scrollTo(sheetOffset(latest, sheet.activeSnapPoint()), true);
      });
      return;
    }
    finishOpening();
    sheet.setTranslate(sheetHiddenSize(current, offset()));
    if (point !== sheet.activeSnapPoint()) sheet.setActiveSnapPoint(point);
  };
  const settleSoon = debounce(settle, SETTLE_DELAY_MS);

  onCleanup(
    sheet.register({
      open: () => {
        const fromClosed = phase() === 'closed';
        if (!fromClosed && phase() !== 'closing') return;
        onClosed = undefined;
        closeFallback.clear();
        setPhase('opening');
        slideOpen(fromClosed);
      },
      close: (done) => {
        if (phase() === 'closed') {
          done();
          return;
        }
        setPhase('closing');
        onClosed = done;
        const current = metrics();
        if (!current || reducedMotion() || offset() <= 1) {
          finishClosing();
          return;
        }
        scrollTo(sheetOffset(current, 0), true);
        // A slide interrupted by the finger, or an engine that never reports
        // its end, still finishes.
        closeFallback();
      },
    })
  );

  // Set up on the content element itself: without a Portal the frame mounts
  // before Corvu renders it, and each opening renders a new one.
  createEffect(
    on(scroller, (element) => {
      if (!element) return;
      setUp(element);
    })
  );
  const setUp = (element: HTMLDivElement) => {
    if (dialog.open()) sheet.setKeepMounted(true);
    const listening = new AbortController();
    onCleanup(() => listening.abort());
    const { signal } = listening;
    // iOS reports scroll positions sparsely during momentum, so a swipe only
    // settles once the finger is up and the position has stopped changing.
    let downOutside = false;
    let downOffset = 0;
    element.addEventListener('scroll', () => settleSoon(), {
      passive: true,
      signal,
    });
    element.addEventListener(
      'scrollend',
      () => {
        settleSoon.clear();
        settle();
      },
      { signal }
    );
    element.addEventListener(
      'touchstart',
      () => {
        touching = true;
        gesture = true;
        settleSoon.clear();
      },
      { passive: true, signal }
    );
    for (const type of ['touchend', 'touchcancel'] as const)
      element.addEventListener(
        type,
        (event) => {
          // Another finger still on the sheet keeps the gesture going.
          if (event.touches.length > 0) return;
          touching = false;
          settleSoon();
        },
        { passive: true, signal }
      );
    // A tap above the sheet (on the scrim) closes it when it lifts, whatever
    // `closeOnOutsidePointerStrategy` says: a drag that starts there moves
    // the sheet like any other swipe. The strategy still applies to pointers
    // outside the sheet's container, such as a menu it opened.
    element.addEventListener(
      'pointerdown',
      (event) => {
        downOutside =
          event.target instanceof Node && !panel?.contains(event.target);
        downOffset = offset();
      },
      { signal }
    );
    element.addEventListener(
      'pointerup',
      (event) => {
        const outside =
          event.target instanceof Node && !panel?.contains(event.target);
        if (!downOutside || !outside || phase() !== 'open') return;
        if (Math.abs(offset() - downOffset) > 2) return;
        sheet.backdropTap(event);
      },
      { signal }
    );
    // Content that loads, a keyboard (the gutter) or a rotation changes the
    // scroll range; hold the sheet at its rest rather than trusting a re-snap.
    const resizes = new ResizeObserver(() => {
      if (phase() === 'open' || phase() === 'opening') settleSoon();
    });
    for (const target of [element, panel, gutter])
      if (target) resizes.observe(target);
    onCleanup(() => resizes.disconnect());

    if (phase() === 'opening') slideOpen(false);
  };

  // An owner that moves the sheet (to full height while the keyboard is up)
  // slides it there, also mid-slide.
  createEffect(
    on(
      sheet.activeSnapPoint,
      (point) => {
        const current = metrics();
        if (!current || (phase() !== 'open' && phase() !== 'opening')) return;
        retargets = 0;
        scrollTo(sheetOffset(current, point), true);
      },
      { defer: true }
    )
  );

  const swipeable = () => local.swipeable !== false;
  const partial = () => sheet.activeSnapPoint() < 1;
  const sliding = () => phase() === 'opening' || phase() === 'closing';

  return (
    <Layer depth={0}>
      <Dialog.Content
        data-corvu-drawer-content=""
        data-side="bottom"
        data-opening={phase() === 'opening' ? '' : undefined}
        data-closing={phase() === 'closing' ? '' : undefined}
        data-transitioning={sliding() ? '' : undefined}
        {...rest}
        forceMount={local.forceMount || sheet.keepMounted()}
        ref={(element: HTMLDivElement) => {
          setScroller(element);
          if (typeof local.ref === 'function') local.ref(element);
        }}
        onFocusIn={(event: FocusEvent) => {
          // A focus that scrolls (Corvu's own, or an owner's) cancels the
          // opening slide; start it again from wherever the focus left it.
          if (phase() === 'opening')
            queueMicrotask(() => {
              const current = metrics();
              if (phase() !== 'opening' || !current) return;
              scrollTo(sheetOffset(current, sheet.activeSnapPoint()), true);
            });
          // Only a scroll body may scroll to an input: scrolling the sheet's
          // own container would slide the sheet.
          if (
            event.target instanceof Element &&
            event.target.closest('[data-drawer-scroll-body]')
          )
            scrollToFocusedInput(event);
          if (typeof local.onFocusIn === 'function') local.onFocusIn(event);
        }}
        class={cn(
          // Block layout, not flex: the panel keeps its width. The padding
          // keeps the sheet inside the horizontal safe area.
          'portal-scope mobile-sheet-scroller fixed inset-0 z-modal block snap-y snap-mandatory overflow-x-hidden overscroll-contain pl-[calc(var(--safe-left,0px)+8px)] pr-[calc(var(--safe-right,0px)+8px)] outline-none',
          swipeable() ? 'overflow-y-auto' : 'overflow-y-hidden',
          // Closing hands taps to the page; a closed forced-mounted sheet
          // takes no room at all.
          phase() === 'closing' && 'pointer-events-none',
          phase() === 'closed' && 'hidden',
          // Session-replay masking belongs to the whole dialog, as it did
          // when the sheet was the dialog element itself.
          local.class?.split(/\s+/).includes('ph-no-capture') && 'ph-no-capture'
        )}
      >
        <Show when={sheet.scrim()}>
          {(scrim) => (
            <div
              data-corvu-drawer-overlay=""
              aria-hidden="true"
              class={cn(
                'mobile-sheet-scrim pointer-events-none fixed inset-0',
                scrim()()
              )}
            />
          )}
        </Show>
        {/* Closed rest: the screen-tall space above the sheet. */}
        <div data-sheet-backdrop class="h-full w-full snap-start" />
        {/* The detent markers sit beside the panel, not in it: a panel that
            clips its content is a scroll container, and would take them. */}
        <div class="relative">
          <For each={sheet.snapPoints().filter((point) => point < 1)}>
            {(point) => (
              <div
                aria-hidden="true"
                class={cn(
                  'pointer-events-none absolute left-0 h-px w-px snap-end',
                  !sheet.allowSkippingSnapPoints() && 'snap-always'
                )}
                style={{ top: `calc(${point * 100}% - 1px)` }}
              />
            )}
          </For>
          <div
            ref={panel}
            data-sheet-panel
            data-sheet-partial={partial() ? '' : undefined}
            style={{
              ...local.panelStyle,
              ...(typeof local.style === 'object' ? local.style : {}),
            }}
            class={cn(local.panelClass, local.class)}
          >
            {local.children}
          </div>
        </div>
        {/* Open rest: the end of the scroll range. */}
        <div
          ref={gutter}
          aria-hidden="true"
          class={cn(
            'w-full snap-end',
            !sheet.allowSkippingSnapPoints() && 'snap-always',
            local.gutterClass
          )}
        />
      </Dialog.Content>
    </Layer>
  );
}

type ContentProps = SheetContentProps & {
  /** Maximum height as a percentage of the viewport (vh). Clamped to 100. Defaults to 80, or `targetHeight` when that is larger. */
  maxHeight?: number;
  /** Initial/start height as a percentage of the viewport (vh). Clamped to 100. Fits content when omitted. */
  targetHeight?: number;
};

/**
 * Drop-in replacement for `Drawer.Content` that handles mobile keyboard
 * behaviour automatically:
 *
 * - Bottom sheets keep an 8px gutter above the screen edge or keyboard.
 * - Left/right sheets fill their host bounds and slide along that edge.
 * - Clamps its height to the visible viewport when the keyboard opens.
 * - When a `MobileDrawer.ScrollBody` is present, hands the safe-area padding
 *   to it so the scroll viewport reaches the drawer's bottom edge
 *
 * Also handles default styling, which can be overridden via the `class` prop.
 * Sheets are opaque, with no backdrop blur behind them or their scrim.
 */
function MobileDrawerContent(props: ContentProps) {
  return (
    <Show
      when={useContext(ScrollSheetContext)}
      fallback={<SideSheetContent {...props} />}
    >
      <BottomSheetContent {...props} />
    </Show>
  );
}

function BottomSheetContent(props: ContentProps) {
  const [local, rest] = splitProps(props, ['maxHeight', 'targetHeight']);
  const maxHeight = () =>
    Math.min(100, local.maxHeight ?? Math.max(80, local.targetHeight ?? 0));
  const targetHeight = () =>
    local.targetHeight != null ? Math.min(100, local.targetHeight) : undefined;

  onCleanup(() => {
    clearTimeout(scrollTimer);
    scrollTimer = undefined;
  });

  return (
    <ScrollSheetFrame
      {...rest}
      panelStyle={{
        '--drawer-max-h': `${maxHeight()}dvh`,
        ...(targetHeight() != null
          ? { '--drawer-h': `${targetHeight()}dvh` }
          : {}),
      }}
      panelClass={cn(
        'mobile-sheet glass bg-menu [--color-dialog:var(--color-menu)] [backdrop-filter:none]! flex flex-col',
        'max-h-[min(var(--drawer-max-h),calc(100dvh-var(--safe-top,0px)-var(--virtual-keyboard-height,0px)-16px))]',
        targetHeight() != null ? 'h-(--drawer-h)' : 'h-fit',
        virtualKeyboardVisible()
          ? 'pb-4 has-[[data-drawer-scroll-body]]:pb-0'
          : 'pb-[max(16px,var(--mobile-sheet-safe-padding))] has-[[data-drawer-scroll-body]]:pb-0'
      )}
      gutterClass="h-[calc(var(--virtual-keyboard-height,0px)+8px)]"
    />
  );
}

/** Left and right sheets keep Corvu's drawer, sliding along their edge. */
function SideSheetContent(props: ContentProps) {
  const [local, rest] = splitProps(props, [
    'class',
    'maxHeight',
    'targetHeight',
    'swipeable',
    'onOpened',
  ]);
  const drawer = Drawer.useContext(props.contextId);

  return (
    <Layer depth={0}>
      <Drawer.Content
        onFocusIn={(e: FocusEvent) => {
          scrollToFocusedInput(e);
        }}
        class={cn(
          'portal-scope',
          'fixed! z-modal glass bg-menu [--color-dialog:var(--color-menu)] [backdrop-filter:none]! flex flex-col data-transitioning:transition-transform data-transitioning:duration-200 ease-out motion-reduce:transition-none',
          // Sheets stay inside the horizontal safe area, like the app frame:
          // the iPhone Duo's control column and landscape notches are there.
          'inset-y-0 h-full w-80 max-w-[calc(100vw-var(--safe-left,0px)-var(--safe-right,0px))] border-edge-frame shadow-menu [--mobile-sheet-safe-padding:var(--safe-bottom,0px)]',
          drawer.side() === 'left'
            ? 'left-(--safe-left) border-r'
            : 'right-(--safe-right) border-l',
          virtualKeyboardVisible()
            ? 'pb-4 has-[[data-drawer-scroll-body]]:pb-0'
            : 'pb-[max(16px,var(--mobile-sheet-safe-padding))] has-[[data-drawer-scroll-body]]:pb-0',
          local.class
        )}
        {...rest}
      />
    </Layer>
  );
}

/**
 * Opt-in sheet whose height stays anchored to the layout viewport while the
 * keyboard opens. The keyboard occupies space inside the sheet instead of
 * moving or shrinking the sheet itself. Put a flexing, min-h-0 thread above
 * KeyboardFooter so only the thread gives up space to the keyboard.
 */
function MobileDrawerFixedContent(
  props: SheetContentProps & {
    /** Maximum height as a percentage of the layout viewport. Defaults to 80. */
    maxHeight?: number;
    /** Fixed height as a percentage of the layout viewport. Defaults to 80. */
    targetHeight?: number;
    /** Keep the footer inside the visible portion of a bottom snap-point sheet. */
    fitSnapPoint?: boolean;
  }
) {
  const [local, rest] = splitProps(props, [
    'maxHeight',
    'targetHeight',
    'fitSnapPoint',
  ]);
  const sheet = useScrollSheet();
  const targetHeight = () => Math.min(100, local.targetHeight ?? 80);
  const maxHeight = () =>
    Math.min(100, local.maxHeight ?? Math.max(80, targetHeight()));

  onCleanup(() => {
    clearTimeout(scrollTimer);
    scrollTimer = undefined;
  });

  return (
    <ScrollSheetFrame
      {...rest}
      panelStyle={{
        '--drawer-h': `${targetHeight()}dvh`,
        '--drawer-max-h': `${maxHeight()}dvh`,
        // Native sets both variables, but Safari only squishes --dvh.
        // 100dvh remains the layout viewport while the keyboard is open.
        '--drawer-keyboard-inset': virtualKeyboardVisible()
          ? 'max(var(--virtual-keyboard-height,0px),calc(100dvh - var(--dvh,1dvh)*100))'
          : '0px',
        // A sheet resting at a smaller snap point is partly below the screen.
        // Reserve that portion so the footer stays on screen.
        '--drawer-snap-inset': local.fitSnapPoint
          ? `${Math.max(0, sheet.translate())}px`
          : '0px',
      }}
      panelClass={cn(
        'mobile-sheet glass bg-menu [--color-dialog:var(--color-menu)] [backdrop-filter:none]! flex flex-col h-(--drawer-h) max-h-[min(var(--drawer-max-h),calc(100dvh-var(--safe-top,0px)-16px))] min-h-0 overflow-hidden',
        local.fitSnapPoint &&
          'transition-[padding-bottom] duration-200 ease-out motion-reduce:transition-none',
        virtualKeyboardVisible()
          ? 'pb-(--drawer-keyboard-inset)'
          : 'pb-[max(16px,var(--mobile-sheet-safe-padding))]',
        local.fitSnapPoint &&
          (virtualKeyboardVisible()
            ? 'pb-[calc(var(--drawer-keyboard-inset)+var(--drawer-snap-inset))]'
            : 'pb-[calc(max(16px,var(--mobile-sheet-safe-padding))+var(--drawer-snap-inset))]'),
        '[&_[data-drawer-scroll-body]]:pb-0'
      )}
      gutterClass="h-2"
    />
  );
}

/** Place after a min-h-0 flexing thread inside FixedContent. */
function MobileDrawerKeyboardFooter(props: ComponentProps<'div'>) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      data-drawer-keyboard-footer
      class={cn('shrink-0', local.class)}
      {...rest}
    />
  );
}

/**
 * The scrim behind a sheet: a plain dim, no blur. A bottom sheet draws it
 * inside its own scroll container so it fades with the swipe; side sheets
 * keep Corvu's overlay.
 */
function MobileDrawerOverlay(props: ComponentProps<typeof Drawer.Overlay>) {
  const sheet = useContext(ScrollSheetContext);
  if (sheet) {
    sheet.setScrim(() => props.class);
    onCleanup(() => sheet.setScrim(undefined));
    return null;
  }
  const [local, rest] = splitProps(props, ['class']);
  return (
    // On the sheets' own layer, as Dialog's scrim is: a sheet opened from
    // another sheet comes later in the document, so its scrim dims the sheet
    // beneath like the rest of the page.
    <Drawer.Overlay
      class={cn('fixed inset-0 z-modal mobile-sheet-scrim', local.class)}
      {...rest}
    />
  );
}

function MobileDrawerItem(props: ComponentProps<'button'>) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <button
      type="button"
      class={cn(
        'flex min-h-11 w-full items-center gap-3 rounded-[20px] px-3 py-2.5 text-left text-sm text-ink transition-colors hover:bg-ink/6 active:bg-ink/10 aria-checked:bg-ink/8 aria-pressed:bg-ink/8 aria-[checked=mixed]:bg-ink/8 aria-[current=page]:bg-ink/8 aria-[current=page]:font-medium focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40',
        local.class
      )}
      {...rest}
    />
  );
}

type ExtendDiv<T extends ValidComponent = 'div'> = ComponentProps<T> & {
  as?: T;
};

/**
 * Component for rendering style Drawer Section Labels.
 */
function MobileDrawerSectionLabel<T extends ValidComponent = 'div'>(
  props: ExtendDiv<T>
) {
  const [local, rest] = splitProps(props, ['as', 'class', 'children']);
  return (
    <Dynamic
      component={local.as ?? 'div'}
      class={cn(
        'px-6 pb-2 text-xs font-medium text-ink-extra-muted',
        local.class
      )}
      {...rest}
    >
      {local.children}
    </Dynamic>
  );
}

/**
 * Component for rendering styled Drawer sections.
 */
function MobileDrawerSection<T extends ValidComponent = 'div'>(
  props: ExtendDiv<T>
) {
  const [local, rest] = splitProps(props, ['as', 'class', 'children']);
  return (
    <Layer depth={2}>
      <Dynamic
        component={(local.as ?? 'div') as ValidComponent}
        class={cn('rounded-3xl mx-3 p-1 bg-ink/3 overflow-clip', local.class)}
        {...rest}
      >
        {local.children}
      </Dynamic>
    </Layer>
  );
}

/**
 * Scrolling body for drawer content. Sits between the pinned chrome (Handle,
 * headers) and the drawer's bottom edge, and scrolls when its sections
 * outgrow the drawer's max height.
 *
 * `flex-auto` rather than `flex-1` on purpose: `Content` defaults to `h-fit`,
 * and a basis-0 child of a fit-content flex column collapses the drawer to a
 * sliver. `flex-auto` hugs content under `h-fit` and still fills the drawer
 * when `targetHeight` makes its height definite.
 *
 * Takes over the safe-area padding from `Content` (via
 * `data-drawer-scroll-body`): padding the drawer itself would end the scroll
 * viewport above the home-indicator inset, so instead the scroll content is
 * padded — the viewport reaches the drawer's bottom edge and the last item
 * still clears the home indicator when scrolled to the end.
 *
 * While a bottom sheet rests at a partial snap point the body doesn't
 * scroll, so a swipe anywhere moves the sheet. Fully open, the body scrolls,
 * and a swipe down from its top hands over to the sheet and dismisses it.
 */
function MobileDrawerScrollBody<T extends ValidComponent = 'div'>(
  props: ExtendDiv<T>
) {
  const [local, rest] = splitProps(props, ['as', 'class', 'children']);
  return (
    <Dynamic
      component={(local.as ?? 'div') as ValidComponent}
      data-drawer-scroll-body
      class={cn(
        'flex min-h-0 flex-auto flex-col overflow-y-auto rounded-b-(--mobile-sheet-radius) [corner-shape:inherit] in-data-[sheet-partial]:overflow-hidden',
        virtualKeyboardVisible()
          ? 'pb-4'
          : 'pb-[max(16px,var(--mobile-sheet-safe-padding))]',
        local.class
      )}
      {...rest}
    >
      {local.children}
    </Dynamic>
  );
}

/**
 * Component for rendering the standard mobile drawer drag handle.
 */
function MobileDrawerHandle<T extends ValidComponent = 'div'>(
  props: ExtendDiv<T>
) {
  const [local, rest] = splitProps(props, ['as', 'class', 'children']);

  return (
    <Dynamic
      component={local.as ?? 'div'}
      class={cn('flex justify-center pt-2 pb-3 shrink-0', local.class)}
      {...rest}
    >
      {local.children ?? <div class="w-9 h-1 rounded-full bg-ink/15" />}
    </Dynamic>
  );
}

/**
 * A Kobalte menu, select, or popover opened inside a drawer portals to
 * `document.body` and, while modal, sets `pointer-events: none` there. A
 * pointer aimed at the menu's backdrop therefore lands on `<html>`, which
 * corvu reads as a pointer outside the drawer — so dismissing the menu would
 * tear down the whole drawer with it. Leave those to the menu's own layer;
 * the next pointer, with no menu open, reaches the overlay and closes the
 * drawer as usual.
 */
function dismissesDrawer(event: PointerEvent) {
  if (event.target === document.documentElement) return false;
  // A nested picker can remove its selected option during pointerup, before
  // Corvu checks containment. The original event path still identifies the
  // drawer that contained the tap; selecting an option must not dismiss it.
  if (event.target instanceof Node && !event.target.isConnected) {
    return !event
      .composedPath()
      .some(
        (node) =>
          node instanceof HTMLElement &&
          node.hasAttribute('data-corvu-drawer-content')
      );
  }
  return true;
}

/**
 * The rest of a tap that dismisses a drawer must not reach what its scrim
 * covered. Corvu dismisses on the tap's pointerdown or pointerup, and a sheet
 * its owner unmounts on close (a `<Show>` around it, or `openDialog`'s host)
 * takes the scrim with it, so pointerup can dismiss the parent and mouse events
 * can press the control underneath. Swallow them until the tap's
 * click, the next pointerdown or a key press, but only once the drawer has
 * really closed: an owner that keeps it open leaves the tap to its target.
 */
function swallowRestOfTap() {
  const listening = new AbortController();
  const swallow = (event: Event) => {
    if (!event.isTrusted) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.type === 'click') listening.abort();
  };
  for (const type of ['pointerup', 'mousedown', 'mouseup', 'click'])
    window.addEventListener(type, swallow, {
      capture: true,
      signal: listening.signal,
    });
  for (const type of ['pointerdown', 'keydown'])
    window.addEventListener(type, () => listening.abort(), {
      capture: true,
      signal: listening.signal,
    });
}

/**
 * A sheet opens with focus on itself unless its first tab stop is something to
 * type into. Corvu's focus trap otherwise focuses that stop, and a browser
 * paints the focus ring for a scripted focus arriving while nothing on the
 * page is focused — which is every tap, since a tapped button is not focused
 * on iOS. That ringed the first row of every sheet of rows.
 *
 * A text field keeps the focus: a sheet that opens for a search or a name is
 * opened to type in. So does whatever the sheet focused itself while opening,
 * such as the heading Settings announces when it drills in. The content
 * element carries `tabindex="-1"`, so the trap, Escape and the sheet's own
 * announcement all still work when the sheet holds focus itself. Sheets that
 * want another control focused name it with `initialFocusEl` or their own
 * `onInitialFocus`, as the comment composer and the model picker do.
 */
function focusSheetOverItsFirstRow(event: Event) {
  const sheet = event.target as HTMLElement | null;
  if (!sheet) return;
  if (sheet.contains(document.activeElement)) {
    // Corvu would move this to the first tab stop; the sheet chose it.
    event.preventDefault();
    return;
  }
  // Focus without scrolling: a focus that scrolls a bottom sheet's container
  // into view cancels its opening slide.
  event.preventDefault();
  const first = sheet.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
  if (first && isEditableInput(first)) first.focus({ preventScroll: true });
  else sheet.focus({ preventScroll: true });
}

type MobileDrawerProps = Omit<
  ComponentProps<typeof Drawer>,
  | 'children'
  | 'snapPoints'
  | 'defaultSnapPoint'
  | 'activeSnapPoint'
  | 'onActiveSnapPointChange'
> & {
  children: JSX.Element;
  /**
   * Bottom sheets only: the visible fractions the sheet rests at, besides
   * fully open (1). Closed (0) is always a rest.
   */
  snapPoints?: DrawerSnapPoint[];
  defaultSnapPoint?: DrawerSnapPoint;
  activeSnapPoint?: DrawerSnapPoint;
  onActiveSnapPointChange?: (point: DrawerSnapPoint) => void;
  /**
   * Stay open when the app navigates. Only for a sheet whose dismissal
   * discards something the user can't get back, such as files shared to
   * the app.
   */
  keepOpenOnNavigation?: boolean;
};

/** Root props that only Corvu's drawer reads; a bottom sheet scrolls instead. */
const CORVU_DRAWER_ONLY_PROPS = [
  'side',
  'breakPoints',
  'dampFunction',
  'velocityFunction',
  'velocityCacheReset',
  'handleScrollableElements',
  'transitionResize',
] as const;

/**
 * A bottom sheet over Corvu's dialog. The dialog stays mounted while the
 * sheet slides away, then unmounts.
 */
function BottomSheetRoot(props: MobileDrawerProps) {
  const [local, , rest] = splitProps(
    props,
    [
      'snapPoints',
      'defaultSnapPoint',
      'activeSnapPoint',
      'onActiveSnapPointChange',
      'allowSkippingSnapPoints',
      'onOutsidePointer',
      'onOpenChange',
      'onInitialFocus',
      'initialOpen',
      'keepOpenOnNavigation',
      'open',
      'children',
    ],
    CORVU_DRAWER_ONLY_PROPS
  );
  // Held here rather than in Corvu, so navigation can close an uncontrolled
  // sheet too.
  const [uncontrolledOpen, setUncontrolledOpen] = createSignal(
    local.initialOpen ?? false
  );
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const open = () => local.open ?? uncontrolledOpen();
  const closed = () => disposed || !open();
  // Keeps the content mounted while it slides away after a close.
  const [keepMounted, setKeepMounted] = createSignal(false);
  let controls: ScrollSheetControls | undefined;

  const snapPoints = () => sheetSnapPoints(local.snapPoints);
  const [uncontrolledSnapPoint, setUncontrolledSnapPoint] = createSignal(
    local.defaultSnapPoint ?? 1
  );
  const activeSnapPoint = () => {
    const point = local.activeSnapPoint ?? uncontrolledSnapPoint();
    // Closed is the open state, not a rest; reopen where the owner starts.
    return point > 0 ? point : (local.defaultSnapPoint ?? 1);
  };
  const [translate, setTranslate] = createSignal(0);
  const [scrim, setScrim] = createSignal<Accessor<string | undefined>>();

  const changeOpen = (next: boolean) => {
    setUncontrolledOpen(next);
    local.onOpenChange?.(next);
  };
  createCloseOnNavigation({
    open: () => !local.keepOpenOnNavigation && open(),
    close: () => changeOpen(false),
  });
  // The dialog closes at once (its focus trap, dismiss layer and Escape go
  // with it); the sheet slides away, then unmounts.
  createEffect(
    on(
      open,
      (isOpen) => {
        if (isOpen) {
          // An owner told 0 at the last close learns where the sheet opens.
          if ((local.activeSnapPoint ?? uncontrolledSnapPoint()) <= 0)
            sheet.setActiveSnapPoint(local.defaultSnapPoint ?? 1);
          controls?.open();
          return;
        }
        if (!controls) {
          setKeepMounted(false);
          return;
        }
        controls.close(() => {
          if (open()) return;
          setKeepMounted(false);
          // A closed sheet reports 0, as Corvu's did, so the owner reopens
          // it at its opening detent rather than where it was left.
          if (activeSnapPoint() !== (local.defaultSnapPoint ?? 1))
            sheet.setActiveSnapPoint(0);
        });
      },
      { defer: true }
    )
  );

  const sheet: ScrollSheetContextValue = {
    open,
    snapPoints,
    activeSnapPoint,
    setActiveSnapPoint: (point) => {
      setUncontrolledSnapPoint(point);
      local.onActiveSnapPointChange?.(point);
    },
    allowSkippingSnapPoints: () => local.allowSkippingSnapPoints !== false,
    translate,
    setTranslate,
    scrim,
    setScrim: (next) => setScrim(() => next),
    keepMounted,
    setKeepMounted,
    requestClose: () => changeOpen(false),
    backdropTap: (event) => {
      local.onOutsidePointer?.(event);
      if (event.defaultPrevented || props.closeOnOutsidePointer === false)
        return;
      changeOpen(false);
      // An owner that unmounts the sheet as it closes takes the scrim with
      // it: the tap's click must not press what was underneath.
      queueMicrotask(() => {
        if (closed()) swallowRestOfTap();
      });
    },
    register: (next) => {
      controls = next;
      return () => {
        if (controls === next) controls = undefined;
      };
    },
  };

  return (
    <ScrollSheetContext.Provider value={sheet}>
      <Dialog
        closeOnOutsideFocus={false}
        noOutsidePointerEvents={false}
        restoreFocus={false}
        {...rest}
        open={open()}
        onOpenChange={changeOpen}
        onInitialFocus={(event) => {
          local.onInitialFocus?.(event);
          if (event.defaultPrevented || props.initialFocusEl) return;
          focusSheetOverItsFirstRow(event);
        }}
        onOutsidePointer={(event) => {
          if (!dismissesDrawer(event)) event.preventDefault();
          local.onOutsidePointer?.(event);
          if (event.defaultPrevented) return;
          queueMicrotask(() => {
            if (closed()) swallowRestOfTap();
          });
        }}
      >
        {local.children}
      </Dialog>
    </ScrollSheetContext.Provider>
  );
}

/** Corvu sizes may be px strings; report fractions, as bottom sheets do. */
function toFraction(point: number | string) {
  return typeof point === 'number' ? point : 1;
}

/** Left and right sheets: Corvu's drawer, which drags along its edge. */
function SideSheetRoot(props: MobileDrawerProps) {
  const [local, , rest] = splitProps(
    props,
    [
      'onOutsidePointer',
      'onOpenChange',
      'onInitialFocus',
      'initialOpen',
      'keepOpenOnNavigation',
    ],
    [
      'snapPoints',
      'defaultSnapPoint',
      'activeSnapPoint',
      'onActiveSnapPointChange',
    ]
  );
  const [uncontrolledOpen, setUncontrolledOpen] = createSignal(
    local.initialOpen ?? false
  );
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const open = () => props.open ?? uncontrolledOpen();
  const closed = () => disposed || !open();
  const changeOpen = (next: boolean) => {
    setUncontrolledOpen(next);
    local.onOpenChange?.(next);
  };
  createCloseOnNavigation({
    open: () => !local.keepOpenOnNavigation && open(),
    close: () => changeOpen(false),
  });
  return (
    // A side sheet inside a bottom sheet's tree is still a side sheet.
    <ScrollSheetContext.Provider value={undefined}>
      <Drawer
        breakPoints={[0.8]}
        closeOnOutsideFocus={false}
        noOutsidePointerEvents={false}
        restoreFocus={false}
        {...rest}
        open={open()}
        onOpenChange={changeOpen}
        onInitialFocus={(event) => {
          local.onInitialFocus?.(event);
          if (event.defaultPrevented || props.initialFocusEl) return;
          focusSheetOverItsFirstRow(event);
        }}
        onOutsidePointer={(event) => {
          if (!dismissesDrawer(event)) event.preventDefault();
          local.onOutsidePointer?.(event);
          if (event.defaultPrevented) return;
          // Corvu asks to close next, but the owner may keep the drawer open:
          // a sheet stacked from another dismiss stack (an imperative
          // dialog's host) is outside it, and the tap belongs to that sheet.
          // The microtask runs after the close request and before the tap's
          // mouse events.
          queueMicrotask(() => {
            if (closed()) swallowRestOfTap();
          });
        }}
      />
    </ScrollSheetContext.Provider>
  );
}

/** A bottom sheet's portal stays mounted through the closing slide. */
function MobileDrawerPortal(props: ComponentProps<typeof Drawer.Portal>) {
  const sheet = useContext(ScrollSheetContext);
  return (
    <Drawer.Portal
      {...props}
      forceMount={props.forceMount || (sheet?.keepMounted() ?? false)}
    />
  );
}

/** What a sheet's parts can read about it. */
function useMobileDrawer() {
  const sheet = useContext(ScrollSheetContext);
  if (sheet)
    return {
      side: () => 'bottom' as const,
      activeSnapPoint: sheet.activeSnapPoint,
      translate: sheet.translate,
    };
  const drawer = Drawer.useContext();
  return {
    side: drawer.side,
    activeSnapPoint: () => toFraction(drawer.activeSnapPoint()),
    translate: drawer.translate,
  };
}

/**
 * Mobile sheet. Bottom sheets (the default) are native scroll containers;
 * left and right sheets use Corvu's drawer. Handles styling and
 * input/virtual keyboard behaviour, and closes the sheet when the app
 * navigates to another page (see `createCloseOnNavigation`).
 */
export const MobileDrawer = Object.assign(
  (props: MobileDrawerProps) => (
    <Show
      when={props.side === 'left' || props.side === 'right'}
      fallback={<BottomSheetRoot {...props} />}
    >
      <SideSheetRoot {...props} />
    </Show>
  ),
  {
    useContext: useMobileDrawer,
    Trigger: Drawer.Trigger,
    Portal: MobileDrawerPortal,
    Overlay: MobileDrawerOverlay,
    Content: MobileDrawerContent,
    FixedContent: MobileDrawerFixedContent,
    KeyboardFooter: MobileDrawerKeyboardFooter,
    Close: Drawer.Close,
    Title: Drawer.Label,
    Description: Drawer.Description,
    ScrollBody: MobileDrawerScrollBody,
    Handle: MobileDrawerHandle,
    Section: MobileDrawerSection,
    Label: MobileDrawerSectionLabel,
    Item: MobileDrawerItem,
  }
);
