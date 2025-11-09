import CaretDown from '@phosphor-icons/core/regular/caret-down.svg';
import { type ComponentProps, type JSX, splitProps } from 'solid-js';
import { type Theme, themeColors, themeStyles } from './Themes';

type SmallTextButton = ComponentProps<'button'> & {
  text: string;
  theme?: Theme;
  showChevron?: boolean;
  rotateChevron?: boolean;
  onClick?: JSX.EventHandler<HTMLButtonElement, MouseEvent>;
  border?: boolean;
  index?: number;
  ref?: HTMLButtonElement;
  maxWidth?: number;
};

export type SmallTextButtonProps = SmallTextButton;

/**
 * SmallTextButton component
 *
 * A text-based variant of IconButton with the same styling and behavior
 *
 * @param props.theme - Optional, defaults to light. Available themes: light, blue, dark, cancel, clear
 * @param props.text - The text to display
 * @param props.onClick - An optional handler for the button's onmousedown event
 * @param props.showChevron - Whether to show the chevron icon
 * @param props.ref - An optional ref to the div wrapper of the button
 * @param props.index - An optional number to reference buttons within a group
 */
export function SmallTextButton(props: SmallTextButtonProps) {
  const [local, rest] = splitProps(props, [
    'text',
    'theme',
    'showChevron',
    'rotateChevron',
    'onClick',
    'border',
    'index',
    'class',
  ]);

  return (
    <button
      {...rest}
      class={`${themeColors[local.theme ?? 'base']} ${themeStyles[local.theme ?? 'base']} ${local.border ? '' : 'border-0'} flex flex-row py-1 px-1 rounded-md justify-center items-center gap-0.5 ${local.class ?? ''}`}
      onmousedown={local.onClick}
      data-index={local.index}
    >
      <div class="w-full text-ink text-xs font-medium font-sans overflow-hidden text-clip whitespace-nowrap flex items-center align-middle gap-2">
        {local.text}
      </div>
      {local.showChevron && (
        <div class="flex w-3 h-3 justify-center items-center">
          <CaretDown class={local.rotateChevron ? 'rotate-180' : ''} />
        </div>
      )}
    </button>
  );
}
