import type { HotkeyToken } from '@core/hotkey/tokens';
import CaretDown from '@icon/regular/caret-down.svg';
import { type Component, type JSX, Show, useContext } from 'solid-js';
import {
  EditableLabel,
  type EditableLabelProps,
  EditingContext,
} from './Editable';
import { BasicHotkey } from './Hotkey';
import { type Theme, themeColors, themeStyles } from './Themes';
import { LabelAndHotKey, Tooltip } from './Tooltip';

type TextOrChildren =
  | { children: string | JSX.Element; text?: undefined }
  | { text: string; children?: undefined };

type TextButton = {
  tooltip?: { label: string; hotkeyToken?: HotkeyToken; shortcut?: string };
  id?: string;
  icon?: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  iconColor?: string;
  width?: string;
  textSize?: string;
  onClick?: JSX.EventHandler<HTMLButtonElement, MouseEvent>;
  onMouseDown?: JSX.EventHandler<HTMLButtonElement, MouseEvent>;
  ref?: (ref: HTMLDivElement) => void | HTMLDivElement;
  disabled?: boolean;
  class?: string;
  hotkeyToken?: HotkeyToken;
  shortcut?: string;
  hideShortcut?: boolean;
  outline?: boolean;
  noGap?: boolean;
  tabIndex?: number;
  buttonRef?: (ref: HTMLButtonElement) => void;
};

// If the button does not have a secondary button for dropdown options, it cannot have a separator nor an optionClickHandler nor a secondaryIcon
interface WithoutSecondaryButton {
  theme: Theme;
  showChevron?: boolean;
  secondaryIcon?: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  secondaryTooltip?: {
    label: string;
    hotkeyToken?: HotkeyToken;
    shortcut?: string;
  };
  rotateChevron?: boolean;
  showSeparator?: false;
  onOptionClick?: undefined;
}

// If the button also has a secondary button, it has to have a separator, an onOptionClick, and AT LEAST ONE OF a chevron or a secondaryIcon
interface WithSecondaryButtonBase {
  // The clear button theme is designed to not have a secondary button
  theme: Theme;
  showChevron?: boolean;
  secondaryIcon?: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  secondaryTooltip?: {
    label: string;
    hotkeyToken?: HotkeyToken;
    shortcut?: string;
  };
  showSeparator?: true;
  rotateChevron?: boolean;
  onOptionClick?: JSX.EventHandler<HTMLButtonElement, MouseEvent>;
}

type RequireAtLeastOne<T, Keys extends keyof T = keyof T> = Pick<
  T,
  Exclude<keyof T, Keys>
> &
  {
    [K in Keys]-?: Required<Pick<T, K>> & Partial<Pick<T, Exclude<Keys, K>>>;
  }[Keys];

type WithSecondaryButton = RequireAtLeastOne<
  WithSecondaryButtonBase,
  'showChevron' | 'secondaryIcon'
>;

type TextButtonProps = TextButton &
  (WithoutSecondaryButton | WithSecondaryButton) &
  TextOrChildren;

/**
 * TextButton component with or without a secondary button for dropdown options.
 *
 * Enable the secondary button by setting the showSeparator and/or optionClickHandler property.
 *
 * The secondary button is not available for the clear theme.
 * @param props.theme
 * @param props.text - The text to display on the button
 * @param props.tooltip - An optional tooltip to display on the button
 * @param props.secondaryTooltip - An optional tooltip to display on the secondary button
 * @param props.icon - An optional SVG icon to display on the left side of the text
 * @param props.width - An optional width for the button, if set to 'min-w-0' button will take up the full width of the parent container. The text will be truncated.
 * @param props.onClick - An optional handler for the button's onmousedown event
 * @param props.onOptionClick - An optional handler for the secondary button's onmousedown event
 * @param props.showChevron - Whether to show the chevron icon
 * @param props.rotateChevron - Whether to rotate the chevron icon
 * @param props.showSeparator - Whether to show the separator and enable the secondary button
 * @param props.ref - An optional ref to the div wrapper of the TextButton and the secondary button if enabled
 */
export function TextButton(props: TextButtonProps) {
  const hasSecondaryButton = () =>
    !!props.onOptionClick || !!props.showSeparator;

  const Wrapper = (props: {
    children: JSX.Element;
    tooltip?: { label: string; hotkeyToken?: HotkeyToken; shortcut?: string };
  }) => {
    if (props.tooltip) {
      return (
        <Tooltip
          tooltip={
            <div class="flex flex-col">
              <LabelAndHotKey
                label={props.tooltip.label}
                hotkeyToken={props.tooltip.hotkeyToken}
                shortcut={props.tooltip.shortcut}
              />
            </div>
          }
        >
          {props.children}
        </Tooltip>
      );
    }
    return props.children;
  };

  return (
    <div
      class={`${themeColors[props.theme]} flex flex-row h-8 max-w-full justify-start items-center gap-0 cursor-default ${props.class ?? ''}`}
      ref={props.ref}
      id={props.id}
    >
      <Wrapper tooltip={props.tooltip}>
        <button
          class={`${themeStyles[props.theme]} flex flex-row h-8 px-2 $
              ${props.outline ? 'border-1 border-edge' : ''}
              justify-center items-center w-full ${props.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
          onClick={props.onClick}
          onMouseDown={props.onMouseDown}
          disabled={props.disabled}
          style={{
            gap: !props.noGap && (props.text || props.children) ? '8px' : '0px',
          }}
          tabIndex={props.tabIndex}
          ref={props.buttonRef}
          data-hotkey-token={props.tooltip?.hotkeyToken}
        >
          {props.icon && (
            <div class="flex justify-start items-center h-full">
              <props.icon class={`flex w-4 h-4 ${props.iconColor ?? ''}`} />
            </div>
          )}
          <div class="flex flex-1 justify-between items-center gap-2 min-w-0">
            <div
              class={`${props.width ? props.width + ' truncate ' : ''}${props.textSize ?? 'text-sm'} flex-1 text-center font-medium leading-5 whitespace-nowrap truncate`}
            >
              {props.text ?? props.children}
            </div>
            <Show
              when={
                !props.hideShortcut && (props.shortcut || props.hotkeyToken)
              }
            >
              <BasicHotkey
                token={props.hotkeyToken}
                shortcut={props.shortcut}
                theme={props.theme}
              />
            </Show>
          </div>
          {props.showChevron && !hasSecondaryButton() && (
            <div class="flex justify-center items-center h-full">
              <CaretDown
                class={`flex w-3 h-3 ${props.rotateChevron ? 'rotate-180' : ''}`}
              />
            </div>
          )}
        </button>
      </Wrapper>
      {hasSecondaryButton() && (
        <button
          class={`${themeStyles[props.theme]} flex h-full px-2 border-l-0 justify-center items-center ${props.outline ? 'border-1 border-edge' : ''}`}
          onClick={props.onOptionClick}
          disabled={props.disabled}
        >
          <Wrapper tooltip={props.secondaryTooltip}>
            {props.secondaryIcon && (
              <div class="flex justify-start items-center h-full">
                <props.secondaryIcon class="flex w-4 h-4" />
              </div>
            )}
            {props.showChevron && (
              <CaretDown
                class={`flex w-3 h-3 ${props.rotateChevron ? 'rotate-180' : ''}`}
              />
            )}
          </Wrapper>
        </button>
      )}
    </div>
  );
}

export function EditingTextButton(
  props: Omit<TextButtonProps, 'text' | 'children'> & EditableLabelProps
) {
  const [_, setIsRenaming] = useContext(EditingContext);
  return (
    <div
      class={`${themeColors[props.theme]} flex flex-row h-8 justify-start items-center gap-0
        cursor-default border shadow-inner border-edge bg-input`}
      ref={props.ref}
    >
      <div
        class={`
        ${themeStyles[props.theme]} flex flex-row h-full px-2 justify-center items-center gap-2`}
      >
        {props.icon && (
          <div class="flex justify-start items-center w-4 h-4">
            <props.icon />
          </div>
        )}
        <div
          class={`${props.width} ${props.width !== undefined && 'truncate'} font-medium text-sm leading-5 whitespace-nowrap`}
        >
          <EditableLabel
            {...props}
            handleCancelEdit={(e) => {
              setIsRenaming(false);
              props.handleCancelEdit?.(e);
            }}
            handleSubmitEdit={(name) => {
              setIsRenaming(false);
              props.handleSubmitEdit?.(name);
            }}
            placeholder={props.placeholder}
            allowEmpty={props.allowEmpty}
          />
        </div>
      </div>
    </div>
  );
}
