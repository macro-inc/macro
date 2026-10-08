import type { ChannelNotificationKind } from '@notifications/channel-notification-kind';
import { cn } from '@ui';
import { Show } from 'solid-js';

export type { ChannelNotificationKind } from '@notifications/channel-notification-kind';

/** Hollow means ordinary activity; filled means a mention or thread reply. */
export function ChannelNotificationIndicator(props: {
  kind: ChannelNotificationKind;
  class?: string;
}) {
  const important = () => props.kind === 'important';
  const label = () =>
    important() ? 'Unread mention or thread reply' : 'Unread channel activity';
  return (
    <Show when={props.kind !== 'none'}>
      <span
        role="img"
        aria-label={label()}
        title={label()}
        data-channel-notification-kind={props.kind}
        class={cn(
          'block size-2 shrink-0 rounded-full',
          important() ? 'bg-accent' : 'border-2 border-accent bg-ink/10',
          props.class
        )}
      />
    </Show>
  );
}
