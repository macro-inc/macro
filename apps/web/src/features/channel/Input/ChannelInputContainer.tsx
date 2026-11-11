import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { cn } from '@ui';
import type { JSX } from 'solid-js';

/**
 * On desktop the composer is the pane's last row, where the corner prompt
 * region sits, so persistent prompts wait while it is shown. Touch devices
 * float it above the dock, which the phone prompt already clears.
 */
export function ChannelInputContainer(props: {
  ref?: (el: HTMLDivElement) => void;
  class?: string;
  children: JSX.Element;
}) {
  return (
    <div
      class={cn(
        'pb-2.5 touch:pb-0 w-full flex justify-center **:data-input-editor-shell:max-h-[calc(60*var(--dvh,1dvh))] mobile:**:data-input-editor-shell:max-h-[calc(32*var(--dvh,1dvh))] touch:px-(--mobile-chrome-gutter) touch:pointer-events-auto',
        props.class
      )}
      data-holds-prompts={isTouchDevice() ? undefined : ''}
      ref={props.ref}
    >
      {props.children}
    </div>
  );
}
