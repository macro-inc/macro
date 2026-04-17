import type { JSX } from 'solid-js';
import { cn } from '@ui/utils/classname';
import { isTouchDevice } from '@core/mobile/isTouchDevice';

type HoverActionsProps = {
  class?: string;
  children: JSX.Element;
  persistentVisible?: boolean;
};

export function HoverActions(props: HoverActionsProps) {
  return (
    <div
      class={cn(
        'absolute right-0 top-0 -translate-y-1/2 z-10',
        props.persistentVisible ? '' : 'hidden group-hover/message:block',
        isTouchDevice() && 'hidden',
        props.class
      )}
      data-message-hover-actions
    >
      {props.children}
    </div>
  );
}
