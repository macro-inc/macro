import type { JSX } from 'solid-js';
import { cn } from '../utils/classname';

/** Shared user prompt bubble for the production chat and agent transcripts. */
export function UserMessageBubble(props: {
  children: JSX.Element;
  class?: string;
}) {
  return (
    <div
      data-user-message-bubble
      class={cn(
        'relative ml-auto w-fit min-w-0 max-w-[85%] rounded-3xl bg-ink px-4 py-2.5 text-panel dark-mode:bg-surface-4 dark-mode:text-ink [&_button]:text-inherit whitespace-pre-wrap wrap-break-word [&_.md>:first-child]:mt-0! [&_.md>:last-child]:mb-0!',
        props.class
      )}
    >
      {props.children}
    </div>
  );
}
