import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { cn } from '@ui';
import type { JSX } from 'solid-js';

type HoverActionsProps = {
  class?: string;
  children: JSX.Element;
  persistentVisible?: boolean;
};

export function HoverActions(props: HoverActionsProps) {
  return (
    <div
      class={cn(
        'absolute right-4 top-0 -translate-y-1/2 z-10',
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
