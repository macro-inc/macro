import type { JSX, ParentProps } from 'solid-js';
import { ICON_SIZES } from '../EntityIcon';

interface ButtonWrapperProps extends ParentProps {
  onClick: JSX.EventHandler<HTMLButtonElement, MouseEvent>;
  size?: keyof typeof ICON_SIZES;
  // If true, button will be hidden until a parent element with class "group/item" is hovered.
  showOnHover?: boolean;
  class?: string;
}

export function HoverButtonWrapper(props: ButtonWrapperProps) {
  return (
    <button
      class={`${props.showOnHover ? 'hidden' : 'ring-1 ring-edge bg-button'}
        ${ICON_SIZES[props.size ?? 'sm']}
        ${props.class || ''}
        flex flex-none ${props.size === 'sm' ? 'p-0.25' : 'p-1.5'} rounded-full justify-center items-center
        text-ink-muted
        transition-scale duration-200
        hover:text-ink hover:scale-105 hover:bg-panel hover-transition-bg
        group-hover/item:flex group-hover/item:bg-panel/50 group-hover/item:ring-1
        group-hover/item:ring-edge group-hover/item:shadow
        group-focus-within/item:flex group-focus-within/item:bg-panel/50 group-focus-within/item:ring-1
        group-focus-within/item:ring-edge group-focus-within/item:shadow
        `}
      onclick={props.onClick}
    >
      {props.children}
    </button>
  );
}
