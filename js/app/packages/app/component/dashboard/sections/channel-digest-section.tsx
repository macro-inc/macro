import { useSplitLayout } from '@app/component/split-layout/layout';
import { useChannelsContext } from '@core/context/channels';
import { formatRelativeDate } from '@core/util/time';
import ChatCircleIcon from '@icon/regular/chat-circle.svg';
import HashIcon from '@icon/regular/hash.svg';
import { createMemo, For, Show } from 'solid-js';

import {
  DashboardEmptyState,
  DashboardSection,
} from '../dashboard-section';
import { DashboardSectionLoading } from '../dashboard-section-loading';

const CHANNELS_LIMIT = 4;

interface ChannelDigestSectionProps {
  class?: string;
}

export function ChannelDigestSection(props: ChannelDigestSectionProps) {
  const { openWithSplit } = useSplitLayout();

  const handleSeeAll = () => {
    openWithSplit({ type: 'component', id: 'channels' });
  };

  return (
    <DashboardSection
      title="Channels"
      icon={<ChatCircleIcon />}
      class={props.class}
      onSeeAll={handleSeeAll}
      size="compact"
      fallback={<DashboardSectionLoading rows={3} />}
    >
      <ChannelDigestContent />
    </DashboardSection>
  );
}

function ChannelDigestContent() {
  const { channels, activityByChannelId } = useChannelsContext();
  const { openWithSplit } = useSplitLayout();

  const recentChannels = createMemo(() => {
    const all = channels() ?? [];
    const activity = activityByChannelId();

    return all
      .filter((channel) => channel.name)
      .map((channel) => {
        const channelActivity = activity[channel.id];
        const hasUnread = channelActivity?.viewed_at
          ? new Date(channel.updated_at) > new Date(channelActivity.viewed_at)
          : true;
        return { channel, hasUnread };
      })
      .sort((a, b) =>
        new Date(b.channel.updated_at).getTime() - new Date(a.channel.updated_at).getTime()
      )
      .slice(0, CHANNELS_LIMIT);
  });

  const handleChannelClick = (channelId: string) => {
    openWithSplit({
      type: 'channel',
      id: channelId,
    });
  };

  return (
    <Show
      when={recentChannels().length > 0}
      fallback={
        <DashboardEmptyState
          icon={<ChatCircleIcon />}
          title="No channels"
          description="Join a channel to get started"
          compact
        />
      }
    >
      <div class="grid grid-cols-2 gap-2 -m-1">
        <For each={recentChannels()}>
          {({ channel, hasUnread }) => (
            <button
              type="button"
              onClick={() => handleChannelClick(channel.id)}
              class="flex items-center gap-2 p-2.5 rounded-lg bg-ink/5 hover:bg-ink/10 active:bg-ink/10 transition-colors text-left"
            >
              <div class="size-8 rounded-lg bg-success/10 flex items-center justify-center shrink-0 relative">
                <HashIcon class="size-4 text-success" />
                <Show when={hasUnread}>
                  <div class="absolute -top-0.5 -right-0.5 size-2 bg-accent rounded-full" />
                </Show>
              </div>
              <div class="flex-1 min-w-0">
                <p class="text-sm text-ink font-medium truncate">
                  {channel.name}
                </p>
                <p class="text-xs text-ink-muted">
                  {formatRelativeDate(channel.updated_at)}
                </p>
              </div>
            </button>
          )}
        </For>
      </div>
    </Show>
  );
}
