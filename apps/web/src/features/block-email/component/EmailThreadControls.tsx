import { TOKENS } from '@core/hotkey/tokens';
import { isMobile } from '@core/mobile/isMobile';
import CheckIcon from '@phosphor/check.svg';
import EnvelopeSimpleIcon from '@phosphor/envelope-simple.svg';
import EnvelopeSimpleOpenIcon from '@phosphor/envelope-simple-open.svg';
import CheckBoldIcon from '@phosphor-icons/core/bold/check-bold.svg?component-solid';
import { Button } from '@ui';
import { Show } from 'solid-js';

export function EmailThreadControls(props: {
  isOwnThread: boolean;
  isDone: boolean;
  isUnread: boolean;
  canToggleDone: boolean;
  onToggleDone: () => void;
  onToggleUnread: () => void;
}) {
  return (
    <Show when={!isMobile()}>
      {/* Read-state toggle. Viewing the thread marks it read, so it
              starts as Mark as unread; marking unread flips it to a bold
              accent closed envelope that re-marks the thread read. */}
      <Show when={props.isOwnThread}>
        <Button
          size="icon-md"
          label={props.isUnread ? 'Mark as read' : 'Mark as unread'}
          hotkey={
            props.isUnread
              ? TOKENS.entity.action.markRead
              : TOKENS.entity.action.markUnread
          }
          onClick={props.onToggleUnread}
          // Keep focus (and the hotkey scope cmd-K reads) in the thread
          // content: focusing the header would hide its commands.
          onMouseDown={(e) => e.preventDefault()}
        >
          <Show
            when={props.isUnread}
            fallback={<EnvelopeSimpleOpenIcon class="size-4" />}
          >
            <EnvelopeSimpleIcon class="size-4 text-accent" />
          </Show>
        </Button>
      </Show>
      <Show when={props.isOwnThread && props.canToggleDone}>
        <Button
          size="icon-md"
          label={props.isDone ? 'Mark as not done' : 'Mark done'}
          hotkey={
            props.isDone
              ? TOKENS.entity.action.markNotDone
              : TOKENS.entity.action.markDone
          }
          onClick={props.onToggleDone}
          // Same focus-preservation as the read-state toggle above.
          onMouseDown={(e) => e.preventDefault()}
        >
          <Show when={props.isDone} fallback={<CheckIcon class="size-4" />}>
            <CheckBoldIcon class="size-4 text-accent" />
          </Show>
        </Button>
      </Show>
    </Show>
  );
}
