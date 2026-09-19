import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { cn } from '@ui';
import type { JSX } from 'solid-js';

type HoverActionsProps = {
  class?: string;
  children: JSX.Element;
  persistentVisible?: boolean;
  /**
   * 'straddle' (default) centers the toolbar on the row's top edge — fine
   * for header rows, whose right side is empty. 'above' places it fully
   * above the row so it never covers the row's own content — needed for
   * grouped rows, where text starts at the very top.
   */
  position?: 'straddle' | 'above';
};

export function HoverActions(props: HoverActionsProps) {
  return (
    <div
      class={cn(
        'absolute right-4 z-10',
        props.position === 'above' ? 'bottom-full' : 'top-0 -translate-y-1/2',
        props.persistentVisible
          ? ''
          : 'hidden group-hover/message:block group-focus-within/message:block',
        isTouchDevice() && 'hidden',
        props.class
      )}
      data-message-hover-actions
    >
      {props.children}
    </div>
  );
}
