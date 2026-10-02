import type { JSX } from 'solid-js';
import { Layer } from './Layer';

/**
 * Shared user prompt bubble for the production chat and agent transcripts.
 *
 * A lifted surface in both modes, in the theme's own palette. Light ramps
 * sit within a few percent lightness of the page, so a hairline edge keeps
 * the bubble legible there; dark ramps lift far enough on their own.
 */
export function UserMessageBubble(props: { children: JSX.Element }) {
  return (
    <Layer depth={3}>
      <div
        data-user-message-bubble
        class="relative ml-auto w-fit min-w-0 max-w-[85%] rounded-3xl bg-surface text-ink px-4 py-2.5 light-mode:border light-mode:border-edge-muted whitespace-pre-wrap wrap-break-word [&_.md>:first-child]:mt-0! [&_.md>:last-child]:mb-0!"
      >
        {props.children}
      </div>
    </Layer>
  );
}
