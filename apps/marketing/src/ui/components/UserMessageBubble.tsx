import type { JSX } from 'solid-js';
import { cn } from '../utils/classname';
import { Layer } from './Layer';
/** Frozen website bubble; no application theme or state. */
export function UserMessageBubble(props: {
  children: JSX.Element;
  class?: string;
}) {
  return (
    <Layer depth={3}>
      <div
        data-user-message-bubble
        class={cn(
          'relative ml-auto w-fit min-w-0 max-w-[85%] rounded-3xl bg-surface text-ink px-4 py-2.5 whitespace-pre-wrap wrap-break-word [&_.md>:first-child]:mt-0! [&_.md>:last-child]:mb-0!',
          props.class
        )}
      >
        {props.children}
      </div>
    </Layer>
  );
}
