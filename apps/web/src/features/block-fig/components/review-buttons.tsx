/**
 * The toolbar's review tools: Comment (C), with the number of unread
 * threads, and Present (⌥⌘↵). Presentational.
 */

import ChatCircle from '@phosphor/chat-circle.svg';
import Play from '@phosphor/play.svg';
import { Button } from '@ui/components/Button';
import { Show } from 'solid-js';

export function CommentButton(props: {
  /** Absent when the design has no comments. */
  comments?: { active: boolean; unread: number; onToggle: () => void };
}) {
  return (
    <Show when={props.comments}>
      {(c) => (
        <div class="relative">
          <Button
            variant="ghost"
            size="icon-md"
            aria-pressed={c().active}
            class={
              c().active
                ? 'rounded-lg bg-accent text-accent-contrast'
                : 'rounded-lg'
            }
            label="Comment (C)"
            tooltip="Comment · C"
            data-testid="fig-tool-comment"
            onClick={() => c().onToggle()}
          >
            <ChatCircle />
          </Button>
          <Show when={c().unread > 0}>
            <span
              class="pointer-events-none absolute top-0.5 right-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-0.5 font-semibold text-[9px] text-accent-contrast"
              data-testid="fig-comments-unread"
            >
              {c().unread}
            </span>
          </Show>
        </div>
      )}
    </Show>
  );
}

export function PresentButton(props: { mac: boolean; onPresent: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon-md"
      label="Present"
      tooltip={`Present · ${props.mac ? '⌥⌘↵' : 'Ctrl+Alt+Enter'}`}
      data-testid="fig-present-button"
      onClick={() => props.onPresent()}
    >
      <Play />
    </Button>
  );
}
