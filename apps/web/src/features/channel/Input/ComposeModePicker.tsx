import { SegmentedControl } from '@ui';
import type { ChannelComposeMode } from './compose-mode';

/**
 * The compose-mode picker shown in the input footer — one segmented control
 * naming every available face (Message, Task, Event), next to the format
 * (`Aa`) button in message mode and next to the composer's own actions in
 * the alternate faces. Rounded as a pill so it reads like the footer's
 * other controls.
 */
export function ComposeModePicker(props: {
  mode: ChannelComposeMode;
  /** Whether the event face is offered. The task face always is. */
  showEvent: boolean;
  onModeChange: (mode: ChannelComposeMode) => void;
}) {
  const options = (): Array<{ value: ChannelComposeMode; label: string }> => [
    { value: 'message', label: 'Message' },
    { value: 'task', label: 'Task' },
    ...(props.showEvent ? [{ value: 'event' as const, label: 'Event' }] : []),
  ];

  return (
    <SegmentedControl
      aria-label="Compose mode"
      size="sm"
      value={props.mode}
      options={options()}
      onChange={props.onModeChange}
      class="h-7 rounded-full bg-surface"
    />
  );
}
