import { keepToastsClearOf } from '@core/component/Toast/toast-clearance';
import { cn } from '@ui';
import type { JSX } from 'solid-js';

/**
 * The composer is the pane's last row on desktop and floats above the dock on
 * touch devices; either way toasts appear where its send button sits, so they
 * rise above it while it is shown.
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
      ref={(element) => {
        keepToastsClearOf(element);
        props.ref?.(element);
      }}
    >
      {props.children}
    </div>
  );
}
