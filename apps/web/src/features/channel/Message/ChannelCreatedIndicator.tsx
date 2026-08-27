import { useChannel } from '@core/context/channels';
import { formatDate } from '@core/util/date';
import ChannelIcon from '@icon/wide-channel.svg';
import { ChannelTypeEnum } from '@service-storage/client';
import { Avatar } from '@ui';
import { Show } from 'solid-js';

type ChannelCreatedIndicatorProps = {
  channelId: string;
};

/**
 * Rendered once at the very top of a channel thread (the oldest message, once
 * the first page has loaded). Shows a channel-glyph avatar alongside a
 * "Channel <name> created" label and the creation timestamp. Skipped for DMs
 * and for channels without a name.
 */
export function ChannelCreatedIndicator(props: ChannelCreatedIndicatorProps) {
  const channel = useChannel(props.channelId);

  const shouldRender = () => {
    const c = channel();
    return !!c && !!c.name && c.channel_type !== ChannelTypeEnum.DirectMessage;
  };

  return (
    <Show when={shouldRender() && channel()}>
      {(c) => (
        <div class="relative w-full pr-2 pl-(--message-padding-x) pt-4 pb-2">
          <div
            class="grid min-w-0 items-center gap-x-2"
            style={{
              'grid-template-columns': 'var(--user-icon-width) minmax(0, 1fr)',
            }}
          >
            <Avatar class="size-(--user-icon-width) bg-surface text-ink-muted ring ring-edge-muted">
              <Avatar.Fallback>
                <ChannelIcon class="size-4" />
              </Avatar.Fallback>
            </Avatar>
            <div class="flex min-w-0 flex-col justify-center">
              <span class="text-sm text-ink">
                Channel <span class="font-semibold">{c().name}</span> created
              </span>
              <span class="text-xs text-ink-extra-muted">
                {formatDate(c().created_at, { showTime: true })}
              </span>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}
