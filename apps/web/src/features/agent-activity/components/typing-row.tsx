import { type JSX, type ParentProps, Show } from 'solid-js';

/**
 * An agent typing in a conversation: its avatar and what it is doing, the
 * way a teammate's typing reads. Whatever the agent is writing right now, and
 * anything it is waiting on, renders beneath as children.
 */
export function TypingRow(
  props: ParentProps<{
    avatar: JSX.Element;
    label: string;
    /** The step under way, for a viewer who can read the session. */
    step?: string;
  }>
) {
  return (
    <div
      class="flex min-w-0 items-start gap-2 py-1 pl-[var(--message-padding-x)] pr-[var(--message-padding-x)]"
      data-agent-typing
    >
      <div class="flex w-[var(--user-icon-width)] shrink-0 justify-center pt-0.5">
        {props.avatar}
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex min-h-6 min-w-0 items-center gap-2 text-xs text-ink-extra-muted">
          <span class="flex shrink-0" role="status" aria-live="polite">
            <span>{props.label}</span>
            <span class="flex" aria-hidden="true">
              <span class="animate-typing-dot [animation-delay:0ms]">.</span>
              <span class="animate-typing-dot [animation-delay:200ms]">.</span>
              <span class="animate-typing-dot [animation-delay:400ms]">.</span>
            </span>
          </span>
          {/* Outside the live region: steps change faster than anyone wants read aloud. */}
          <Show when={props.step}>
            {(step) => (
              <span class="min-w-0 truncate text-ink-muted" data-typing-step>
                {step()}
              </span>
            )}
          </Show>
        </div>
        {props.children}
      </div>
    </div>
  );
}
