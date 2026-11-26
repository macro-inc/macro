import AtIcon from '@icon/system/regular/at.svg';
import BellSlashIcon from '@icon/system/regular/bell-slash.svg';
import { cn, Tooltip } from '@ui';
import { Match, Switch } from 'solid-js';

/** Marks a conversation that is muted, or that notifies for @mentions only. */
export function ChannelMutedIndicator(props: {
  muted: boolean;
  mentionsOnly?: boolean;
  class?: string;
}) {
  const tooltipClass = () =>
    cn('size-4 shrink-0 justify-center text-ink-extra-muted', props.class);
  return (
    <Switch>
      <Match when={props.muted}>
        <Tooltip
          as="span"
          label="Notifications are muted"
          placement="top"
          class={tooltipClass()}
        >
          <span
            aria-label="Notifications muted"
            class="flex size-full items-center justify-center"
          >
            <BellSlashIcon class="size-full" />
          </span>
        </Tooltip>
      </Match>
      <Match when={props.mentionsOnly}>
        <Tooltip
          as="span"
          label="Notifies you only when you are @mentioned"
          placement="top"
          class={tooltipClass()}
        >
          <span
            aria-label="Notifications for @mentions only"
            data-testid="channel-mentions-only-indicator"
            class="flex size-full items-center justify-center"
          >
            <AtIcon class="size-full" />
          </span>
        </Tooltip>
      </Match>
    </Switch>
  );
}
