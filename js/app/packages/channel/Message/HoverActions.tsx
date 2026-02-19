import type { JSX } from 'solid-js';
import { cn } from '@ui/utils/classname';

type HoverActionsProps = {
  class?: string;
  children: JSX.Element;
};

export function HoverActions(props: HoverActionsProps) {
  return (
    <div
      class={cn(
        'absolute right-2 top-0 -translate-y-1/2 opacity-0 group-hover/message:opacity-100 transition-opacity z-10',
        props.class
      )}
    >
      {props.children}
    </div>
  );
}
