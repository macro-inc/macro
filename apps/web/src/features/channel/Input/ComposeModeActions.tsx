import CalendarBlankIcon from '@phosphor/calendar-blank.svg';
import CheckSquareIcon from '@phosphor/check-square.svg';
import { Show } from 'solid-js';
import { InputActionButton } from './ActionButton';
import type { ChannelComposeMode } from './compose-mode';

/**
 * The compose-mode actions shown in the input footer — an icon button per
 * alternate face (task, event), styled like the attach and format buttons.
 * A button lights up while its face is open; clicking it again returns to
 * the message face, and clicking the other button switches faces directly.
 */
export function ComposeModeActions(props: {
  mode: ChannelComposeMode;
  /** Whether the event action is offered. The task action always is. */
  showEvent: boolean;
  onModeChange: (mode: ChannelComposeMode) => void;
}) {
  const toggle = (target: ChannelComposeMode) =>
    props.onModeChange(props.mode === target ? 'message' : target);

  return (
    <>
      <InputActionButton
        label="Create task"
        active={props.mode === 'task'}
        onClick={() => toggle('task')}
      >
        <CheckSquareIcon />
      </InputActionButton>
      <Show when={props.showEvent}>
        <InputActionButton
          label="Create event"
          active={props.mode === 'event'}
          onClick={() => toggle('event')}
        >
          <CalendarBlankIcon />
        </InputActionButton>
      </Show>
    </>
  );
}
