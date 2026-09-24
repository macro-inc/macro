import type { JSX } from 'solid-js';

/**
 * Shared user prompt bubble for the production chat and agent transcripts.
 * The filled treatment is an `inverted` scope, so markdown, chips, buttons and
 * the selection highlight inside it read against the fill rather than the page.
 */
export function UserMessageBubble(props: { children: JSX.Element }) {
  return (
    <div
      data-user-message-bubble
      class="relative ml-auto w-fit min-w-0 max-w-[85%] rounded-3xl px-4 py-2.5 not-dark-mode:inverted dark-mode:bg-surface-4 dark-mode:text-ink [&_button]:text-inherit whitespace-pre-wrap wrap-break-word [&_.md>:first-child]:mt-0! [&_.md>:last-child]:mb-0!"
    >
      {props.children}
    </div>
  );
}
