import { followKeyboardViewport } from '@core/mobile/viewport-insets';
import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { isEditableInput } from '@core/util/isEditableInput';
import Drawer, { type Size } from '@corvu/drawer';
import { Layer } from '@ui/components/Layer';
import { cn } from '@ui/utils/classname';
import {
  type ComponentProps,
  createSignal,
  onCleanup,
  splitProps,
  type ValidComponent,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { createCloseOnNavigation } from './close-on-navigation';

export type { Size as DrawerSnapPoint } from '@corvu/drawer';

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
 */
function MobileDrawerContent(
  props: ComponentProps<typeof Drawer.Content> & {
    /** Maximum height as a percentage of the viewport (vh). Clamped to 100. Defaults to 80, or `targetHeight` when that is larger. */
    maxHeight?: number;
    /** Initial/start height as a percentage of the viewport (vh). Clamped to 100. Fits content when omitted. */
    targetHeight?: number;
    /**
     * Paint the opaque menu fill instead of the default translucent glass.
     * Use when the sheet shows a message over page text (mention previews).
     */
    opaque?: boolean;
  }
) {
  const [local, rest] = splitProps(props, [
    'class',
    'ref',
    'maxHeight',
    'targetHeight',
    'opaque',
  ]);

  const drawer = Drawer.useContext(props.contextId);
  const horizontal = () =>
    drawer.side() === 'left' || drawer.side() === 'right';
  const maxHeight = () =>
    Math.min(100, local.maxHeight ?? Math.max(80, local.targetHeight ?? 0));
  const targetHeight = () =>
    local.targetHeight != null ? Math.min(100, local.targetHeight) : undefined;

  onCleanup(() => {
    clearTimeout(scrollTimer);
    scrollTimer = undefined;
  });

  return (
    <Layer depth={0}>
      <Drawer.Content
        ref={(element: HTMLElement) => {
          // Sheets sit above the keyboard and size against it.
          followKeyboardViewport(element);
          if (typeof local.ref === 'function') local.ref(element);
        }}
        onFocusIn={(e: FocusEvent) => {
          scrollToFocusedInput(e);
        }}
        style={{
          '--drawer-max-h': `${maxHeight()}dvh`,
          ...(targetHeight() != null
            ? { '--drawer-h': `${targetHeight()}dvh` }
            : {}),
        }}
        class={cn(
          'portal-scope',
          'fixed! z-modal glass flex flex-col data-transitioning:transition-transform data-transitioning:duration-200 ease-out motion-reduce:transition-none',
          // Sheets stay inside the horizontal safe area, like the app frame:
          // the iPhone Duo's control column and landscape notches are there.
          horizontal()
            ? 'inset-y-0 h-full w-80 max-w-[calc(100vw-var(--safe-left,0px)-var(--safe-right,0px))] border-edge-frame shadow-menu [--mobile-sheet-safe-padding:var(--safe-bottom,0px)]'
            : 'left-[calc(var(--safe-left,0px)+8px)] right-[calc(var(--safe-right,0px)+8px)] bottom-[calc(var(--virtual-keyboard-height,0px)+8px)] mobile-sheet max-h-[min(var(--drawer-max-h),calc(100dvh-var(--safe-top,0px)-var(--virtual-keyboard-height,0px)-16px))]',
          horizontal() &&
            (drawer.side() === 'left'
              ? 'left-(--safe-left) border-r'
              : 'right-(--safe-right) border-l'),
          local.opaque
            ? 'bg-menu [--color-dialog:var(--color-menu)]'
            : 'bg-menu-glass [--color-dialog:var(--color-menu-glass)]',
          !horizontal() &&
            (targetHeight() != null ? 'h-(--drawer-h)' : 'h-fit'),
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
  props: ComponentProps<typeof Drawer.Content> & {
    /** Maximum height as a percentage of the layout viewport. Defaults to 80. */
    maxHeight?: number;
    /** Fixed height as a percentage of the layout viewport. Defaults to 80. */
    targetHeight?: number;
    /** Keep the footer inside the visible portion of a bottom snap-point sheet. */
    fitSnapPoint?: boolean;
    opaque?: boolean;
  }
) {
  const [local, rest] = splitProps(props, [
    'class',
    'ref',
    'maxHeight',
    'targetHeight',
    'opaque',
    'fitSnapPoint',
  ]);
  const drawer = Drawer.useContext();
  const targetHeight = () => Math.min(100, local.targetHeight ?? 80);
  const maxHeight = () =>
    Math.min(100, local.maxHeight ?? Math.max(80, targetHeight()));

  onCleanup(() => {
    clearTimeout(scrollTimer);
    scrollTimer = undefined;
  });

  return (
    <Layer depth={0}>
      <Drawer.Content
        ref={(element: HTMLElement) => {
          // Sheets sit above the keyboard and size against it.
          followKeyboardViewport(element);
          if (typeof local.ref === 'function') local.ref(element);
        }}
        onFocusIn={(e: FocusEvent) => {
          // A pinned footer is already above the keyboard. Scrolling Content
          // for its input would move the header inside this fixed-height sheet.
          if (
            e.target instanceof Element &&
            e.target.closest('[data-drawer-scroll-body]')
          )
            scrollToFocusedInput(e);
        }}
        style={{
          '--drawer-h': `${targetHeight()}dvh`,
          '--drawer-max-h': `${maxHeight()}dvh`,
          // Native sets both variables, but Safari only squishes --dvh.
          // 100dvh remains the layout viewport while the keyboard is open.
          '--drawer-keyboard-inset': virtualKeyboardVisible()
            ? 'max(var(--virtual-keyboard-height,0px),calc(100dvh - var(--dvh,1dvh)*100))'
            : '0px',
          // Corvu moves a full-height sheet offscreen at smaller snap points.
          // Reserve that translated portion so the footer stays on screen.
          '--drawer-snap-inset': local.fitSnapPoint
            ? `${Math.max(0, drawer.translate())}px`
            : '0px',
        }}
        class={cn(
          'portal-scope',
          'fixed! inset-x-2 bottom-2 z-modal mobile-sheet glass flex flex-col h-(--drawer-h) max-h-[min(var(--drawer-max-h),calc(100dvh-var(--safe-top,0px)-16px))] min-h-0 overflow-hidden data-transitioning:duration-200 ease-out motion-reduce:transition-none',
          local.fitSnapPoint
            ? 'data-transitioning:transition-[transform,padding-bottom]'
            : 'data-transitioning:transition-transform',
          virtualKeyboardVisible()
            ? 'pb-(--drawer-keyboard-inset)'
            : 'pb-[max(16px,var(--mobile-sheet-safe-padding))]',
          local.fitSnapPoint &&
            (virtualKeyboardVisible()
              ? 'pb-[calc(var(--drawer-keyboard-inset)+var(--drawer-snap-inset))]'
              : 'pb-[calc(max(16px,var(--mobile-sheet-safe-padding))+var(--drawer-snap-inset))]'),
          '[&_[data-drawer-scroll-body]]:pb-0',
          local.opaque
            ? 'bg-menu [--color-dialog:var(--color-menu)]'
            : 'bg-menu-glass [--color-dialog:var(--color-menu-glass)]',
          local.class
        )}
        {...rest}
      />
    </Layer>
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

function MobileDrawerOverlay(props: ComponentProps<typeof Drawer.Overlay>) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    // On the sheets' own layer, as Dialog's scrim is: a sheet opened from
    // another sheet comes later in the document, so its scrim dims the sheet
    // beneath like the rest of the page.
    <Drawer.Overlay
      class={cn('fixed inset-0 z-modal scrim-glass', local.class)}
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
        'flex min-h-0 flex-auto flex-col overflow-y-auto rounded-b-(--mobile-sheet-radius) [corner-shape:inherit]',
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
  if (isEditableInput(sheet.querySelector(FOCUSABLE_SELECTOR))) return;
  event.preventDefault();
  sheet.focus();
}

/**
 * Wrapper around Corvu's Drawer for mobile. Handles styling and input/virtual
 * keyboard behaviour, and closes the drawer when the app navigates to another
 * page (see `createCloseOnNavigation`).
 */
export const MobileDrawer = Object.assign(
  (
    props: ComponentProps<typeof Drawer> & {
      /**
       * Stay open when the app navigates. Only for a sheet whose dismissal
       * discards something the user can't get back, such as files shared to
       * the app.
       */
      keepOpenOnNavigation?: boolean;
    }
  ) => {
    const [local, rest] = splitProps(props, [
      'onOutsidePointer',
      'onOpenChange',
      'onInitialFocus',
      'activeSnapPoint',
      'onActiveSnapPointChange',
      'breakPoints',
      'initialOpen',
      'keepOpenOnNavigation',
    ]);
    // Held here rather than in Corvu, so navigation can close an uncontrolled
    // drawer too.
    const [uncontrolledOpen, setUncontrolledOpen] = createSignal(
      local.initialOpen ?? false
    );
    let disposed = false;
    onCleanup(() => {
      disposed = true;
    });
    const open = () => props.open ?? uncontrolledOpen();
    const closed = () => disposed || !open();
    // A drag past the break point moves Corvu to its closed snap point before
    // it asks to close. An owner that keeps the drawer open (to confirm a
    // discard) would leave it parked off-screen behind its scrim, so return
    // it to the open snap point. It starts closed, as Corvu's own state does,
    // so opening slides it in.
    const [activeSnapPoint, setActiveSnapPoint] = createSignal<Size>(0);
    let lastOpenSnapPoint: Size = props.defaultSnapPoint ?? 1;
    const changeSnapPoint = (point: Size) => {
      const previousPoint = local.activeSnapPoint ?? activeSnapPoint();
      if (point === 0 && previousPoint !== 0) lastOpenSnapPoint = previousPoint;
      if (point !== 0) lastOpenSnapPoint = point;
      setActiveSnapPoint(point);
      local.onActiveSnapPointChange?.(point);
    };
    const changeOpen = (next: boolean) => {
      setUncontrolledOpen(next);
      local.onOpenChange?.(next);
      if (!next && !closed()) changeSnapPoint(lastOpenSnapPoint);
    };
    createCloseOnNavigation({
      open: () => !local.keepOpenOnNavigation && open(),
      close: () => changeOpen(false),
    });
    return (
      <Drawer
        breakPoints={
          local.breakPoints ?? (props.snapPoints ? undefined : [0.8])
        }
        closeOnOutsideFocus={false}
        noOutsidePointerEvents={false}
        restoreFocus={false}
        {...rest}
        open={open()}
        activeSnapPoint={local.activeSnapPoint ?? activeSnapPoint()}
        onActiveSnapPointChange={changeSnapPoint}
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
    );
  },
  {
    useContext: Drawer.useContext,
    Trigger: Drawer.Trigger,
    Portal: Drawer.Portal,
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
