import BellSlashIcon from '@phosphor/bell-slash.svg';
import { cn, Tooltip } from '@ui';
import { Show } from 'solid-js';

export function ChannelMutedIndicator(props: {
  muted: boolean;
  class?: string;
}) {
  return (
    <Show when={props.muted}>
      <Tooltip
        as="span"
        label="Notifications are muted"
        placement="top"
        class={cn(
          'size-4 shrink-0 justify-center text-ink-extra-muted',
          props.class
        )}
      >
        <span
          aria-label="Notifications muted"
          class="flex size-full items-center justify-center"
        >
          <BellSlashIcon class="size-full" />
        </span>
      </Tooltip>
    </Show>
  );
}
