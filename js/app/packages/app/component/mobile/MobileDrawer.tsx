import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { isEditableInput } from '@core/util/isEditableInput';
import Drawer from '@corvu/drawer';
import { Layer } from '@ui';
import { cn } from '@ui/utils/classname';
import {
  onCleanup,
  splitProps,
  type ComponentProps,
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
 *
 * Also handles default styling, which can be overridden via the `class` prop.
 */
function MobileDrawerContent(props: ComponentProps<typeof Drawer.Content>) {
  const [local, rest] = splitProps(props, ['class']);

  onCleanup(() => {
    clearTimeout(scrollTimer);
    scrollTimer = undefined;
  });

  return (
    <Layer depth={1}>
      <Drawer.Content
        onFocusIn={(e: FocusEvent) => {
          scrollToFocusedInput(e);
        }}
        class={cn(
          'bottom-[var(--virtual-keyboard-height,0)] fixed left-0 right-0 z-modal bg-panel rounded-t-2xl flex flex-col max-h-[80vh] data-transitioning:transition-transform data-transitioning:duration-200 ease-out',
          virtualKeyboardVisible()
            ? 'pb-0 max-h-[calc(80vh-var(--virtual-keyboard-height))] overflow-y-auto'
            : 'pb-(--safe-bottom)',
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
    Handle: MobileDrawerHandle,
    Section: MobileDrawerSection,
    Label: MobileDrawerSectionLabel,
  }
);
