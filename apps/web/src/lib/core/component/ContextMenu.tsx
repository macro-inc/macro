import type { HotkeyToken } from '@core/hotkey/tokens';
import { isMobile } from '@core/mobile/isMobile';
import { ContextMenu } from '@kobalte/core/context-menu';
import CaretRight from '@phosphor/caret-right.svg?component-solid';
import CheckIcon from '@phosphor/check.svg?component-solid';
import {
  addCtrlJKMenuNavigation,
  cn,
  highlightFirstMenuItemOnOpen,
  Layer,
} from '@ui';
import { Hotkey } from '@ui/components/Hotkey';
import {
  type Component,
  createEffect,
  type JSX,
  Match,
  onCleanup,
  type ParentProps,
  Show,
  Switch,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';

/*
 * ContextMenu-only abstractions. The DropdownMenu equivalents that used to
 * live alongside these (in the old `Menu.tsx`) have been retired in favor of
 * `@ui` `Dropdown`. Right-click menus still use this file because they need
 * separate behavior + positioning from the click-triggered Dropdown.
 */

type BaseMenuItemWrapperProps = {
  children: JSX.Element;
  disabled?: boolean;
  onClick?: () => void;
  closeOnSelect?: boolean;
  selectorType?: 'checkbox' | 'radio';
  class?: string;
};

type CheckboxMenuItemWrapperProps = BaseMenuItemWrapperProps & {
  selectorType: 'checkbox';
  checked?: boolean;
  onChange?: (value: boolean) => void;
};

type RadioMenuItemWrapperProps = BaseMenuItemWrapperProps & {
  selectorType: 'radio';
  value: string;
};

type MenuItemWrapperProps =
  | BaseMenuItemWrapperProps
  | CheckboxMenuItemWrapperProps
  | RadioMenuItemWrapperProps;

function MenuItemWrapper(props: MenuItemWrapperProps) {
  return (
    <Switch>
      <Match when={props.selectorType === 'checkbox'}>
        <ContextMenu.CheckboxItem
          class={props.class}
          checked={(props as CheckboxMenuItemWrapperProps).checked}
          onChange={(props as CheckboxMenuItemWrapperProps).onChange}
          disabled={props.disabled}
          onSelect={props.onClick}
          closeOnSelect={props.closeOnSelect}
        >
          {props.children}
        </ContextMenu.CheckboxItem>
      </Match>
      <Match when={props.selectorType === 'radio'}>
        <ContextMenu.RadioItem
          class={props.class}
          value={(props as RadioMenuItemWrapperProps).value}
          disabled={props.disabled}
          onSelect={props.onClick}
          closeOnSelect={props.closeOnSelect}
        >
          {props.children}
        </ContextMenu.RadioItem>
      </Match>
      <Match when={!props.selectorType}>
        <ContextMenu.Item
          class={props.class}
          disabled={props.disabled}
          onSelect={props.onClick}
          closeOnSelect={props.closeOnSelect}
        >
          {props.children}
        </ContextMenu.Item>
      </Match>
    </Switch>
  );
}

type BaseMenuItemProps = {
  text?: string | JSX.Element;
  icon?: Component<JSX.SvgSVGAttributes<SVGSVGElement>> | JSX.Element;
  iconClass?: string;
  onClick?: () => void;
  disabled?: boolean;
  closeOnSelect?: boolean;
  class?: string;
  hotkeyToken?: HotkeyToken;
  shortcut?: string;
};

type CheckboxMenuItemProps = BaseMenuItemProps & {
  selectorType: 'checkbox';
  checked: boolean;
  onChange?: (value: boolean) => void;
  value?: undefined;
};

type RadioMenuItemProps = BaseMenuItemProps & {
  selectorType: 'radio';
  value: string;
  groupValue: string;
  checked?: undefined;
  onChange?: undefined;
};

type GenericMenuItemProps = BaseMenuItemProps & {
  selectorType?: undefined;
  onChange?: undefined;
  checked?: undefined;
  value?: undefined;
};

type MenuItemProps =
  | GenericMenuItemProps
  | CheckboxMenuItemProps
  | RadioMenuItemProps;

export const MENU_ITEM_CLASS = `group rounded-lg w-full flex items-center gap-1.5 text-left text-ink font-normal cursor-default outline-none data-[highlighted]:bg-ink/5 data-disabled:opacity-50 data-disabled:cursor-not-allowed ${isMobile() ? 'py-2 px-1.5 text-base' : 'p-1.5 px-2 text-sm'}`;

/**
 * A context-menu item with consistent styling.
 *
 * Supports three variants:
 * - Regular menu item (with optional icon and chevron)
 * - Checkbox menu item (with checkbox selection)
 * - Radio menu item (with radio button selection)
 */
export function MenuItem(props: MenuItemProps) {
  return (
    <MenuItemWrapper
      class={cn(
        MENU_ITEM_CLASS,
        props.disabled && 'opacity-50 cursor-not-allowed',
        props.class
      )}
      onClick={props.onClick}
      disabled={props.disabled}
      closeOnSelect={props.closeOnSelect}
      selectorType={props.selectorType}
      value={props.value}
      checked={props.checked}
      onChange={props.onChange}
    >
      <Show when={props.selectorType === 'checkbox'}>
        <div
          class={cn(
            'shrink-0 flex items-center justify-center',
            isMobile() ? 'size-5' : 'size-4'
          )}
        >
          <CheckIcon
            class={cn(
              'size-3.5 shrink-0 rounded-sm p-0.5',
              (props as CheckboxMenuItemProps).checked
                ? 'bg-accent text-[white]'
                : 'bg-transparent text-transparent border border-edge'
            )}
          />
        </div>
      </Show>
      <Show when={props.selectorType === 'radio'}>
        <div
          class={cn(
            'flex items-center justify-center shrink-0',
            isMobile() ? 'size-5' : 'size-4'
          )}
        >
          <div
            class={cn(
              'size-3.5 shrink-0 rounded-full',
              (props as RadioMenuItemProps).value ===
                (props as RadioMenuItemProps).groupValue
                ? 'bg-accent text-[white]'
                : 'bg-transparent text-transparent border border-edge'
            )}
          />
        </div>
      </Show>
      <Show when={props.icon}>
        <Show when={typeof props.icon === 'function'}>
          <Dynamic
            component={
              props.icon as Component<JSX.SvgSVGAttributes<SVGSVGElement>>
            }
            class={cn(
              'shrink-0',
              isMobile() ? 'size-5' : 'size-4',
              props.iconClass
            )}
          />
        </Show>
        <Show when={typeof props.icon === 'object'}>
          {props.icon as JSX.Element}
        </Show>
      </Show>
      <Show when={props.text}>
        <div class="flex-1 truncate pr-[2em]">{props.text}</div>
      </Show>
      <Show when={props.hotkeyToken || props.shortcut}>
        <Hotkey
          token={props.hotkeyToken}
          shortcut={props.shortcut}
          class="ml-auto"
          theme="subtle"
          showPlus
        />
      </Show>
    </MenuItemWrapper>
  );
}

export function SubTrigger(props: {
  text: string | JSX.Element;
  icon?: Component<JSX.SvgSVGAttributes<SVGSVGElement>> | JSX.Element;
  iconClass?: string;
  disabled?: boolean;
}) {
  return (
    <ContextMenu.SubTrigger
      class={cn(
        MENU_ITEM_CLASS,
        props.disabled && 'opacity-50 cursor-not-allowed'
      )}
      disabled={props.disabled}
    >
      <Show when={props.icon}>
        <Show when={typeof props.icon === 'function'}>
          <Dynamic
            component={
              props.icon as Component<JSX.SvgSVGAttributes<SVGSVGElement>>
            }
            class={cn(
              'shrink-0',
              isMobile() ? 'size-5' : 'size-4',
              props.iconClass
            )}
          />
        </Show>
        <Show when={typeof props.icon === 'object'}>
          {props.icon as JSX.Element}
        </Show>
      </Show>
      <div class="flex-1 truncate">{props.text}</div>
      <CaretRight class="size-4 shrink-0" />
    </ContextMenu.SubTrigger>
  );
}

export function MenuGroup(props: { children: JSX.Element; class?: string }) {
  return (
    <ContextMenu.Group class={cn('w-full', props.class)}>
      {props.children}
    </ContextMenu.Group>
  );
}

export function MenuSeparator() {
  return (
    <ContextMenu.Separator class="my-1.5 -mx-1.5 w-[calc(100%+0.75rem)] border-t border-edge" />
  );
}

function MobileConditionalOverlay(
  props: ParentProps<{ mobileFullScreen?: boolean }>
) {
  return (
    <Show when={props.mobileFullScreen && isMobile()} fallback={props.children}>
      <div class="z-modal fixed inset-0 flex justify-center items-center bg-modal-overlay backdrop-blur-sm">
        {props.children}
      </div>
    </Show>
  );
}

const MENU_SURFACE_SCOPE = '[--color-surface:var(--color-menu)]';

export const MENU_CONTENT_CLASS = `flex flex-col justify-start items-start border border-edge bg-menu ${MENU_SURFACE_SCOPE} shadow-menu rounded-xl p-1.5 cursor-default select-none max-w-full max-h-[calc(100dvh-10rem)] overflow-y-auto z-modal menu-open-animation`;

type MenuContentProps = ParentProps<{
  class?: string;
  submenu?: boolean;
  onOpenAutoFocus?: (event: Event) => void;
  onCloseAutoFocus?: (event: Event) => void;
  overrideStyling?: boolean;

  // The following props can be used to create a mobile-friendly full-screen context menu. See Message.tsx for an example.
  mobileFullScreen?: boolean;

  navId?: string;
}>;

export function ContextMenuContent(props: ParentProps<MenuContentProps>) {
  let contentRef: HTMLDivElement | undefined;

  const BOTTOM_OFFSET = 48;
  const updatePosition = (
    positioner: HTMLElement | null | undefined,
    navItem: Element | HTMLElement | null | undefined
  ) => {
    if (!positioner) return;

    const positionerHeight = positioner.getBoundingClientRect().height;

    if (positioner.style.minWidth !== 'none') {
      positioner.style.minWidth = '100vw';
      positioner.style.transform = 'none';
      positioner.style.left = '8px';
    }

    if (navItem instanceof HTMLElement) {
      const box = navItem.getBoundingClientRect();

      if (
        box.top + box.height + positionerHeight >
        window.innerHeight - BOTTOM_OFFSET
      ) {
        positioner.style.top = `${box.top - positionerHeight}px`;
      } else {
        positioner.style.top = `${box.top + box.height}px`;
      }
    } else {
      positioner.style.left = '8px';
      positioner.style.display = 'flex';
      positioner.style.flexDirection = 'column';
      positioner.style.justifyContent = 'center';
      positioner.style.minHeight = '100%';
      positioner.style.minWidth = '100vw';
    }
  };

  // This createEffect is a heinous hack to prevent kobalte's default context menu positioning on mobile. Forking / patching Kobalte would be cleaner, but this works for now.
  createEffect(() => {
    const positioner = contentRef?.closest('[data-popper-positioner]');
    if (!positioner || !(positioner instanceof HTMLElement)) return;

    if (!isMobile()) {
      return;
    }

    let observer: MutationObserver | undefined;

    const timeoutId = setTimeout(() => {
      const positioner = contentRef?.closest('[data-popper-positioner]');
      const navItem = document.querySelector(`[data-nav-id="${props.navId}"]`);

      if (positioner instanceof HTMLElement) {
        observer = new MutationObserver(() => {
          updatePosition(positioner, navItem);
        });

        observer.observe(positioner, {
          attributes: true,
          attributeFilter: ['style'],
        });

        updatePosition(positioner, navItem);
      }
    }, 0);

    onCleanup(() => {
      clearTimeout(timeoutId);
      observer?.disconnect();
    });
  });

  createEffect(() => {
    if (!contentRef) return;
    const cleanup = addCtrlJKMenuNavigation(contentRef);
    onCleanup(cleanup);
  });

  const handleOpenAutoFocus = (event: Event) => {
    props.onOpenAutoFocus?.(event);
    if (!event.defaultPrevented && contentRef) {
      highlightFirstMenuItemOnOpen(contentRef);
    }
  };

  return (
    <MobileConditionalOverlay mobileFullScreen={props.mobileFullScreen}>
      <Show
        when={props.submenu}
        fallback={
          <Layer depth={2}>
            <ContextMenu.Content
              class={cn(
                MENU_SURFACE_SCOPE,
                !props.overrideStyling && MENU_CONTENT_CLASS,
                'menu-open-animation',
                props.class,
                props.mobileFullScreen &&
                  isMobile() &&
                  'flex flex-col justify-center px-4 max-h-[80vh] shrink w-[calc(100vw-1rem)]'
              )}
              onOpenAutoFocus={handleOpenAutoFocus}
              ref={contentRef}
              onCloseAutoFocus={props.onCloseAutoFocus}
            >
              {props.children}
            </ContextMenu.Content>
          </Layer>
        }
      >
        <ContextMenu.Portal>
          <Layer depth={2}>
            <ContextMenu.SubContent
              class={cn(MENU_CONTENT_CLASS, props.class)}
              ref={contentRef}
            >
              {props.children}
            </ContextMenu.SubContent>
          </Layer>
        </ContextMenu.Portal>
      </Show>
    </MobileConditionalOverlay>
  );
}
