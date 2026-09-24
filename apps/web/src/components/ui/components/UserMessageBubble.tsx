import type { JSX } from 'solid-js';

/**
 * Shared user prompt bubble for the production chat and agent transcripts.
 *
 * `data-user-message-bubble` carries the fill: index.css paints the bubble
 * there and re-derives the content tokens its subtree reads from the bubble's
 * own foreground, which a class list cannot do.
 */
export function UserMessageBubble(props: { children: JSX.Element }) {
  return (
    <div
      data-user-message-bubble
      class="relative ml-auto w-fit min-w-0 max-w-[85%] rounded-3xl px-4 py-2.5 [&_button]:text-inherit whitespace-pre-wrap wrap-break-word [&_.md>:first-child]:mt-0! [&_.md>:last-child]:mb-0!"
    >
      {props.children}
    </div>
  );
}
