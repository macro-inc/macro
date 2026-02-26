import type { JSX } from 'solid-js';
import { cn } from '@ui/utils/classname';

type HoverActionsProps = {
  class?: string;
  children: JSX.Element;
  persistentVisible?: boolean;
};

export function HoverActions(props: HoverActionsProps) {
  return (
    <div
      class={cn(
        'absolute right-2 top-0 -translate-y-1/2 z-10',
        props.persistentVisible
          ? 'opacity-100'
          : 'opacity-0 group-hover/message:opacity-100',
        props.class
      )}
      data-message-hover-actions
    >
      {props.children}
    </div>
  );
}
