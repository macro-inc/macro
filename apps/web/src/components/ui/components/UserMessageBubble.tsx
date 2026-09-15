import type { JSX } from 'solid-js';

/** Shared user prompt bubble for the production chat and agent transcripts. */
export function UserMessageBubble(props: { children: JSX.Element }) {
  return (
    <div
      data-user-message-bubble
      class="relative ml-auto w-fit min-w-0 max-w-[85%] rounded-3xl bg-surface-4 px-4 py-2.5 text-ink whitespace-pre-wrap wrap-break-word [&_.md>:first-child]:mt-0! [&_.md>:last-child]:mb-0!"
    >
      {props.children}
    </div>
  );
}
