import { cn, Layer } from '@ui';
import type { JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';

export const SoupSectionHeader = (props: {
  children: JSX.Element;
  onClick?: () => void;
  highlighted?: boolean;
  class?: string;
}) => {
  return (
    <Layer depth={2}>
      <Dynamic
        component={props.onClick ? 'button' : 'div'}
        type={props.onClick ? 'button' : undefined}
        onClick={props.onClick}
        data-highlighted={props.highlighted || undefined}
        class={cn(
          'group/header relative w-[calc(100%-0.5rem)] mx-1 my-0.5 rounded-lg px-2 py-1.5 flex items-center gap-2.5 text-xs font-semibold tracking-tight',
          'text-text-muted bg-surface border border-edge-muted relative',
          props.onClick && 'hover:bg-active',
          props.class,
          props.highlighted && 'bg-active'
        )}
      >
        {props.children}
      </Dynamic>
    </Layer>
  );
};
