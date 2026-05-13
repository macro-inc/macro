/**
 * @file These components are deprecated and should not be used in new code.
 * Menu best practices are to use Kobalte Menu with our styled components from Menu.tsx.
 * This file is only for legacy support of a few non-standard menus that have not yet been migrated.
 */

import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  autoUpdate,
  computePosition,
  flip,
  limitShift,
  offset,
  shift,
} from '@floating-ui/dom';
import CaretRight from '@phosphor-icons/core/regular/caret-right.svg?component-solid';
import { cn } from '@ui';
import {
  type Component,
  createEffect,
  createSignal,
  type JSX,
  onCleanup,
  type ParentProps,
  Show,
} from 'solid-js';

interface OldBaseItemProps {
  spacerTop?: boolean;
  spacerBottom?: boolean;
}
function OldBaseItem(props: ParentProps<OldBaseItemProps>) {
  return (
    <div class="flex flex-col justify-start items-start w-full">
      <Show when={props.spacerTop}>
        <h4 class="my-1 border-edge border-t w-full" />
      </Show>
      <div class="px-1 w-full">{props.children}</div>
      <Show when={props.spacerBottom}>
        <h4 class="my-1 border-edge border-t w-full" />
      </Show>
    </div>
  );
}

export interface OldMenuItemProps extends OldBaseItemProps {
  text: string | JSX.Element;
  icon?: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  iconClass?: string;
  onClick?: JSX.EventHandler<HTMLDivElement, MouseEvent>;
  chevron?: boolean;
  submenu?: JSX.Element;
  disabled?: boolean;
  selected?: boolean;
  secondaryActionHandler?: JSX.EventHandler<HTMLButtonElement, MouseEvent>;
  secondaryIcon?: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  onTouchStart?: JSX.EventHandler<HTMLDivElement, TouchEvent>;
  onTouchEnd?: JSX.EventHandler<HTMLDivElement, TouchEvent>;
  hotkey?: string | JSX.Element;
  textSize?: 'base' | 'sm';
  menuRef?: HTMLDivElement;
}

export function OldMenuItem(props: OldMenuItemProps) {
  const [showSubmenu, setShowSubmenu] = createSignal(false);
  const [submenuPosition, setSubmenuPosition] = createSignal({ x: 0, y: 0 });
  const [submenuRef, setSubmenuRef] = createSignal<HTMLDivElement>();
  const [menuItemRef, setMenuItemRef] = createSignal<HTMLDivElement>();
  const selected = () => props.selected ?? false;

  createEffect(() => {
    const submenuRef_ = submenuRef();
    const menuItemRef_ = menuItemRef();
    if (!submenuRef_ || !menuItemRef_ || !showSubmenu()) return;

    const cleanup = autoUpdate(menuItemRef_, submenuRef_, async () => {
      const { x, y } = await computePosition(menuItemRef_, submenuRef_, {
        placement: 'right',
        middleware: [
          offset(0),
          flip({
            fallbackStrategy: 'bestFit',
          }),
          shift({
            padding: 8,
            limiter: limitShift(),
          }),
        ],
      });
      setSubmenuPosition({ x, y });
    });

    onCleanup(() => cleanup());
  });

  return (
    <OldBaseItem spacerTop={props.spacerTop} spacerBottom={props.spacerBottom}>
      <div
        class={cn('group', !isTouchDevice() && 'relative')}
        on:touchstart={props.onTouchStart}
        on:touchend={props.onTouchEnd}
        onmouseenter={() => setShowSubmenu(true)}
        onmouseleave={(e) => {
          const submenuEl = submenuRef();
          const menuEl = props.menuRef;
          const toElement = e.relatedTarget as HTMLElement;
          if (submenuEl && menuEl) {
            if (
              toElement &&
              (menuEl?.contains(toElement) || toElement === menuEl)
            ) {
              setShowSubmenu(false);
              return;
            }
          } else if (submenuEl) {
            if (
              toElement &&
              (submenuEl.contains(toElement) || toElement === submenuEl)
            ) {
              return;
            }
          }
          if (!menuEl) setShowSubmenu(false);
        }}
        ref={setMenuItemRef}
      >
        <div
          class={cn(
            'flex flex-row w-full justify-between items-center rounded',
            isMobile() ? 'py-2 px-1' : 'p-1',
            props.disabled
              ? 'opacity-50 cursor-not-allowed text-ink'
              : selected()
                ? 'bg-accent/10'
                : 'hover:bg-hover hover-transition-bg text-ink'
          )}
          onmousedown={(e) => {
            if (!props.disabled && props.onClick) {
              props.onClick(e);
            }
          }}
        >
          <div
            class={cn(
              'flex flex-row w-full gap-1.5 justify-start items-center font-medium',
              props.textSize === 'base'
                ? 'text-base'
                : isMobile()
                  ? 'text-base'
                  : 'text-sm',
              props.secondaryActionHandler && 'max-w-[calc(100%-18px)]'
            )}
          >
            {props.icon && (
              <div
                class={cn(
                  'flex justify-center items-center shrink-0',
                  isMobile() ? 'size-5' : 'size-4',
                  selected() && 'text-accent',
                  props.iconClass
                )}
              >
                <props.icon class="size-full" />
              </div>
            )}
            <div class="w-full truncate">{props.text}</div>
            <Show when={props.hotkey}>
              <div class="ml-auto pr-1 text-ink-extra-muted">
                {props.hotkey}
              </div>
            </Show>
          </div>
          <Show
            when={props.secondaryActionHandler && props.secondaryIcon}
            keyed
          >
            {(SecondaryIcon) => (
              <button
                class="hidden group-hover:flex flex-none justify-center items-center hover:bg-hover rounded size-5 text-ink-muted hover:text-ink transition-colors hover:transition-none"
                onmousedown={props.secondaryActionHandler}
                data-testid="secondary-action-button"
              >
                <div class="flex justify-center items-center size-4">
                  <SecondaryIcon />
                </div>
              </button>
            )}
          </Show>
          <Show when={props.submenu || props.chevron}>
            <div class="flex justify-center items-center size-3.5">
              <CaretRight class="size-full" />
            </div>
          </Show>
        </div>
        <Show when={showSubmenu() && props.submenu}>
          <div
            class="absolute"
            ref={setSubmenuRef}
            onmouseleave={(e) => {
              // If the menu item has a menuRef, we use sticky hover, i.e. don't close the submenu on mouseleave
              if (props.menuRef) return;
              const menuItemEl = menuItemRef();
              if (menuItemEl) {
                const toElement = e.relatedTarget as HTMLElement;
                if (
                  toElement &&
                  (menuItemEl.contains(toElement) || toElement === menuItemEl)
                ) {
                  return;
                }
              }
              setShowSubmenu(false);
            }}
            style={{
              left: `${isTouchDevice() ? '0' : submenuPosition().x}px`,
              top: `${isTouchDevice() ? '0' : submenuPosition().y}px`,
              transform: `translateX(${isTouchDevice() ? '100%' : '0'})`,
            }}
          >
            {props.submenu}
          </div>
        </Show>
      </div>
    </OldBaseItem>
  );
}

type OldMenuWidth = 'sm' | 'md' | 'lg' | `w-${string}` | 'screen';
const oldMenuWidths: Record<OldMenuWidth, string> = {
  sm: 'w-28',
  md: 'w-44',
  lg: 'w-72',
  screen: 'w-screen',
};
interface OldMenuProps {
  width?: OldMenuWidth;
  class?: string;
  hide?: boolean;
}
export function OldMenu(props: ParentProps<OldMenuProps>) {
  return (
    <div
      class={cn(
        'flex flex-col py-1 justify-start items-start bg-surface shadow-lg rounded-md ring-1 ring-edge cursor-default select-none',
        props.width && (oldMenuWidths[props.width] ?? props.width),
        isTouchDevice() && 'relative',
        props.hide && 'hidden',
        props.class
      )}
    >
      {props.children}
    </div>
  );
}
