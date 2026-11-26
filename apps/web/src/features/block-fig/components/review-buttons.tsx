/**
 * The toolbar's review tools: Comment (C), with the number of unread
 * threads, and Present (⌥⌘↵). Presentational.
 */

import ChatCircle from '@icon/system/regular/chat-circle.svg';
import Play from '@icon/system/regular/play.svg';
import { CountBadge } from '@ui/components/Badge';
import { Button } from '@ui/components/Button';
import { Show } from 'solid-js';

export function CommentButton(props: {
  /** Absent when the design has no comments. */
  comments?: { active: boolean; unread: number; onToggle: () => void };
}) {
  return (
    <Show when={props.comments}>
      {(c) => (
        <Button
          aria-label={
            c().unread > 0 ? `Comment (C), ${c().unread} unread` : 'Comment (C)'
          }
          variant="ghost"
          size={c().unread > 0 ? 'md' : 'icon-md'}
          aria-pressed={c().active}
          class={
            c().active
              ? 'rounded-lg bg-accent text-accent-contrast'
              : 'rounded-lg'
          }
          tooltip="Comment · C"
          data-testid="fig-tool-comment"
          onClick={() => c().onToggle()}
        >
          <ChatCircle class="size-4 touch:size-6 shrink-0 pointer-events-none" />
          <CountBadge count={c().unread} data-testid="fig-comments-unread" />
        </Button>
      )}
    </Show>
  );
}

export function PresentButton(props: { mac: boolean; onPresent: () => void }) {
  return (
    <Button
      aria-label="Present"
      variant="ghost"
      size="icon-md"
      tooltip={`Present · ${props.mac ? '⌥⌘↵' : 'Ctrl+Alt+Enter'}`}
      data-testid="fig-present-button"
      onClick={() => props.onPresent()}
    >
      <Play class="size-4 touch:size-6 shrink-0 pointer-events-none" />
    </Button>
  );
}
