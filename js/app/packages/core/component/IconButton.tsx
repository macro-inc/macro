import { useTokenToHotkeyString } from '@core/hotkey/hotkeys';
import type { HotkeyToken } from '@core/hotkey/tokens';
import { isMobileWidth } from '@core/mobile/mobileWidth';
import { onKeyDownClick, onKeyUpClick } from '@core/util/click';
import CaretDown from '@phosphor-icons/core/regular/caret-down.svg';
import {
  type Component,
  type ComponentProps,
  createMemo,
  For,
  type JSX,
  Show,
  splitProps,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { BasicHotkey } from './Hotkey';
import { type Theme, themeColors, themeStyles } from './Themes';
import { LabelAndHotKey, NullTooltip, Tooltip } from './Tooltip';

type IconButton = ComponentProps<'button'> & {
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  iconSize?: number;
  theme?: Theme;
  size?: 'sm' | 'base' | 'lg' | 'xs';
  showChevron?: boolean;
  onClick?: JSX.EventHandler<HTMLButtonElement, MouseEvent | KeyboardEvent>;
  border?: boolean;
  index?: number;
  ref?: HTMLButtonElement | ((el: HTMLButtonElement) => void);
  onDeepClick?: JSX.EventHandler<HTMLButtonElement, MouseEvent>; // This is for non-onmousedown events (eg opening settings panel);
  onTouchEnd?: JSX.EventHandler<HTMLButtonElement, TouchEvent>;
  tooltip?:
    | {
        label: string;
        hotkeyToken?: HotkeyToken;
        shortcut?: string;
        delayOverride?: number;
      }
    | {
        label: string;
        hotkeyToken?: HotkeyToken;
        shortcut?: string;
        delayOverride?: number;
      }[]
    | null;
  tabIndex?: number;
  showShortcut?: boolean;
};

export type IconButtonProps = IconButton;

/**
 * IconButton component
 *
 * Enable the secondary button by setting the showSeparator and/or optionClickHandler property.
 *
 * The secondary button is not available for the clear theme.
 * @param props.theme - Optional, defaults to light. Available themes: light, blue, dark, cancel, clear
 * @param props.icon - An SVG icon to display
 * @param props.size - Optional, defaults to base. Available sizes: sm (size-6), base (size-8), lg (size-12)
 * @param props.onClick - An optional handler for the button's onmousedown event
 * @param props.showChevron - Whether to show the chevron icon
 * @param props.ref - An optional ref to the div wrapper of the IconButton and the secondary button if enabled
 * @param props.index - An optional number to reference IconButtons within a group e.g. in MultiSelect
 * @param props.tooltip - An optional tooltip to display when hovering over the button. Pass null to hide any active
 *     tooltip when hovering over the button without having an own tooltip.
 * @param props.showShortcut - Whether to show the shortcut key on the actual button itself. Defaults to false and
 *     you only need to pass if you also pass a tooltip with a shortcut key.
 */
export function IconButton(props: IconButtonProps) {
  const [local, rest] = splitProps(props, [
    'icon',
    'theme',
    'size',
    'showChevron',
    'onDeepClick',
    'onClick',
    'border',
    'index',
    'class',
    'disabled',
    'tooltip',
    'onTouchEnd',
    'tabIndex',
  ]);

  const tooltips = () => {
    if (Array.isArray(local.tooltip)) {
      return local.tooltip;
    } else if (local.tooltip) {
      return [local.tooltip];
    }
    if (local.tooltip === null) return null;
    return undefined;
  };
  const Wrapper = (props: { children: JSX.Element }) => {
    if (tooltips()) {
      return (
        <Tooltip
          tooltip={
            <div class="flex flex-col">
              <For each={tooltips()}>
                {(tooltip) => (
                  <LabelAndHotKey
                    label={tooltip.label}
                    hotkeyToken={tooltip.hotkeyToken}
                    shortcut={tooltip.shortcut}
                  />
                )}
              </For>
            </div>
          }
          delayOverride={tooltips()?.[0]?.delayOverride}
        >
          {props.children}
        </Tooltip>
      );
    } else if (tooltips() === null) {
      return <NullTooltip>{props.children}</NullTooltip>;
    }
    return <>{props.children}</>;
  };

  const primaryHotkey = createMemo(() => {
    const tips = tooltips();
    if (!tips) return undefined;
    if (tips[0]?.hotkeyToken) {
      const hotkey = useTokenToHotkeyString(tips[0].hotkeyToken);
      if (hotkey()) {
        return hotkey();
      }
    }
    if (tips[0]?.shortcut) {
      return <BasicHotkey shortcut={tips[0].shortcut} />;
    }
    return undefined;
  });

  const sizeClasses = createMemo(() => {
    switch (local.size ?? 'base') {
      case 'xs':
        return 'h-5 w-5';
      case 'sm':
        return 'h-6 w-6';
      case 'lg':
        return 'h-12 w-12';
      default:
        return 'h-8 w-8';
    }
  });

  const defaultIconSize = createMemo(() => {
    switch (local.size ?? 'base') {
      case 'xs':
        return 12;
      case 'sm':
        return 16;
      case 'lg':
        return 24;
      default:
        return 20;
    }
  });

  return (
    <Wrapper>
      <button
        {...rest}
        disabled={local.disabled}
        class={`${themeColors[local.theme ?? 'base']} ${themeStyles[local.theme ?? 'base']} ${local.border ? '' : 'border-0'} flex flex-row ${sizeClasses()} justify-center items-center gap-0.5 ${local.class ?? ''} ${local.disabled ? 'opacity-50 cursor-not-allowed' : ''} relative`}
        onMouseDown={local.onClick}
        onKeyDown={onKeyDownClick(local.onClick)}
        onKeyUp={onKeyUpClick(local.onClick)}
        onclick={local.onDeepClick}
        onTouchEnd={local.onTouchEnd}
        data-index={local.index}
        tabIndex={local.tabIndex}
      >
        <div
          class="flex justify-start items-center"
          classList={{ 'text-panel': local.theme === 'reverse' }}
        >
          <Dynamic
            component={local.icon}
            style={{
              'overflow-clip-margin': 'content-box',
            }}
            width={props.iconSize ?? defaultIconSize()}
            height={props.iconSize ?? defaultIconSize()}
          />
        </div>
        <Show when={local.showChevron}>
          <div
            class="flex h-full justify-center items-center"
            classList={{ 'text-panel': local.theme === 'reverse' }}
          >
            <CaretDown class="flex w-3 h-3" />
          </div>
        </Show>
        <Show when={props.showShortcut && primaryHotkey()}>
          {(key) => {
            return (
              <div
                class="absolute bottom-[-0.5px] right-[-0.5px] text-[7.5px] uppercase pointer-events-none font-semibold"
                classList={{ invisible: isMobileWidth() }}
              >
                {key()}
              </div>
            );
          }}
        </Show>
      </button>
    </Wrapper>
  );
}
