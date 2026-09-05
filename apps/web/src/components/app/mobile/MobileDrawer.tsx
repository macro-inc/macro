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
  const container = e.currentTarget as HTMLElement;
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
 * - Positions itself above the virtual keyboard via `bottom-(--virtual-keyboard-height)`
 * - Switches between `pb-(--safe-bottom)` and `pb-0` based on whether any
 *   input/textarea inside the drawer currently has focus (detected via
 *   bubbling focusin/focusout — no per-input wiring needed)
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
          '--drawer-max-h': `${maxHeight()}vh`,
          ...(targetHeight() != null
            ? { '--drawer-h': `${targetHeight()}vh` }
            : {}),
        }}
        class={cn(
          'portal-scope',
          'bottom-0 fixed inset-x-0 z-modal bg-surface rounded-t-2xl flex flex-col max-h-(--drawer-max-h) data-transitioning:transition-transform data-transitioning:duration-200 ease-out',
          targetHeight() != null ? 'h-(--drawer-h)' : 'h-fit',
          virtualKeyboardVisible()
            ? [
                'pb-(--virtual-keyboard-height) max-h-[calc(100vh-var(--safe-top))] overflow-y-auto',
                // A fixed-height drawer grows by the keyboard so its content
                // keeps its designed height; a fit-content drawer has no
                // --drawer-h and just clamps.
                targetHeight() != null &&
                  'h-[min(calc(100vh-var(--safe-top)),calc(var(--drawer-h)+var(--virtual-keyboard-height)))]',
              ]
            : 'pb-(--safe-bottom) has-[[data-drawer-scroll-body]]:pb-0',
          local.class
        )}
        {...rest}
      />
    </Layer>
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
        'px-3 pb-2 text-xs font-medium text-ink-muted uppercase tracking-wide',
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
        class={cn('rounded-2xl mx-3 overflow-clip', local.class)}
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
        'flex min-h-0 flex-auto flex-col overflow-y-auto',
        !virtualKeyboardVisible() && 'pb-(--safe-bottom)',
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
      class={cn('flex justify-center pt-3 pb-2 shrink-0', local.class)}
      {...rest}
    >
      {local.children ?? <div class="w-10 h-1 rounded-full bg-edge-muted" />}
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
    Overlay: Drawer.Overlay,
    Content: MobileDrawerContent,
    Close: Drawer.Close,
    ScrollBody: MobileDrawerScrollBody,
    Handle: MobileDrawerHandle,
    Section: MobileDrawerSection,
    Label: MobileDrawerSectionLabel,
  }
);
