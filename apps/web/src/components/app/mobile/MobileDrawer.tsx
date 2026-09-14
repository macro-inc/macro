import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { isEditableInput } from '@core/util/isEditableInput';
import Drawer from '@corvu/drawer';
import { cn, Layer } from '@ui';
import {
  type ComponentProps,
  onCleanup,
  splitProps,
  type ValidComponent,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';

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

/**
 * Drop-in replacement for `Drawer.Content` that handles mobile keyboard
 * behaviour automatically:
 *
 * - Keeps an 8px gutter above the screen edge or virtual keyboard.
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
  }
) {
  const [local, rest] = splitProps(props, [
    'class',
    'maxHeight',
    'targetHeight',
  ]);

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
          'fixed! inset-x-2 bottom-[calc(var(--virtual-keyboard-height,0px)+8px)] z-modal mobile-sheet glass bg-menu-glass [--color-dialog:var(--color-menu-glass)] flex flex-col max-h-[min(var(--drawer-max-h),calc(100dvh-var(--safe-top,0px)-var(--virtual-keyboard-height,0px)-16px))] data-transitioning:transition-transform data-transitioning:duration-200 ease-out motion-reduce:transition-none',
          targetHeight() != null ? 'h-(--drawer-h)' : 'h-fit',
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

function MobileDrawerOverlay(props: ComponentProps<typeof Drawer.Overlay>) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <Drawer.Overlay
      class={cn('fixed inset-0 z-modal-overlay scrim-glass', local.class)}
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
        'flex min-h-11 w-full items-center gap-3 rounded-[20px] px-3 py-2.5 text-left text-sm text-ink transition-colors hover:bg-ink/6 active:bg-ink/10 aria-checked:bg-ink/8 aria-pressed:bg-ink/8 aria-[checked=mixed]:bg-ink/8 focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-40',
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
 * Wrapper around Corvu's Drawer for mobile. Handles styling and input/virtual keyboard behaviour.
 */
export const MobileDrawer = Object.assign(
  (props: ComponentProps<typeof Drawer>) => (
    <Drawer
      breakPoints={[0.8]}
      closeOnOutsideFocus={false}
      noOutsidePointerEvents={false}
      restoreFocus={false}
      {...props}
    />
  ),
  {
    Trigger: Drawer.Trigger,
    Portal: Drawer.Portal,
    Overlay: MobileDrawerOverlay,
    Content: MobileDrawerContent,
    Close: Drawer.Close,
    ScrollBody: MobileDrawerScrollBody,
    Handle: MobileDrawerHandle,
    Section: MobileDrawerSection,
    Label: MobileDrawerSectionLabel,
    Item: MobileDrawerItem,
  }
);
