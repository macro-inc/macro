import { AdaptiveScroller } from '@app/component/dashboard/adaptive-scroller';
import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { useSplitLayout } from '@app/component/split-layout/layout';
import { getChannelParams } from '@channel/Channel/link';
import {
  StaticMarkdown,
  StaticMarkdownContext,
} from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import {
  createTheme,
  theme as markdownTheme,
} from '@core/component/LexicalMarkdown/theme';
import { UserIcon } from '@core/component/UserIcon';
import { useUserId } from '@core/context/user';
import { useDisplayName } from '@core/user/displayName';
import { formatDate } from '@core/util/date';
import type { ChannelEntity, EntityData } from '@entity';
import ArrowRightIcon from '@phosphor/arrow-right.svg';
import BuildingIcon from '@phosphor/building.svg';
import UsersIcon from '@phosphor/users.svg';
import { useSoupItemsQuery } from '@queries/soup/items';
import { ChannelType } from '@service-comms/generated/models/channelType';
import { Avatar, Button, Layer, Tooltip } from '@ui';
import { createMemo, For, Show } from 'solid-js';

const compactMarkdownTheme = createTheme(
  {
    paragraph: 'm-0 text-[1em] leading-5',
    list: {
      listitem: 'm-0 leading-5',
    },
  },
  markdownTheme
);

type ChannelCardData = {
  id: string;
  name: string;
  type: string;
  latest: {
    content: string;
    senderId?: string;
    messageId?: string;
    threadId?: string | null;
  };
  updatedAt: string;
  unreadCount: number;
  participantCount: number;
  dmUserId?: string;
};

function channelDisplayName(name: string | null | undefined) {
  const trimmed = name?.trim().replace(/^#+/, '').trim();
  return trimmed || 'Untitled channel';
}

function initials(name: string) {
  const letters = channelDisplayName(name)
    .replace(/[,_./\\-]+/g, ' ')
    .split(/\s+/)
    .flatMap((part) => part.match(/[a-zA-Z0-9]/)?.[0] ?? [])
    .slice(0, 2)
    .map((letter) => letter.toUpperCase());

  return letters.join('') || '?';
}

function ChannelCard(props: {
  channel: ChannelCardData;
  onOpen: (channelId: string, event: MouseEvent) => void;
}) {
  const [senderName] = useDisplayName(props.channel.latest.senderId as any);
  const currentUserId = useUserId();
  const senderLabel = () => {
    const senderId = props.channel.latest.senderId;

    if (!senderId) return;

    if (senderId === currentUserId()) return 'You';

    return senderName();
  };

  return (
    <button
      class="group flex min-h-20 w-64 shrink-0 snap-start flex-col justify-between rounded-2xl border border-edge-muted bg-hover/60 p-3 text-left transition hover:border-edge hover:bg-hover focus:outline-none focus-visible:border-accent @md/recent-channels:h-36 @md/recent-channels:w-auto @md/recent-channels:min-w-0"
      onClick={(event) => props.onOpen(props.channel.id, event)}
    >
      <div class="flex items-start justify-between gap-3">
        <div class="flex min-w-0 items-center gap-3">
          <Show
            when={props.channel.dmUserId}
            fallback={
              <Avatar
                size="md"
                class="bg-default/20 px-1 text-default @md/recent-channels:size-10"
              >
                <Avatar.Fallback>
                  {initials(props.channel.name)}
                </Avatar.Fallback>
              </Avatar>
            }
          >
            {(dmUserId) => (
              <UserIcon
                id={dmUserId()}
                size="md"
                suppressClick
                showTooltip={false}
                class="@md/recent-channels:size-10"
              />
            )}
          </Show>
          <div class="flex min-w-0 flex-col gap-0.5">
            <div class="flex min-w-0 items-center gap-1.5">
              <Show when={props.channel.type === ChannelType.organization}>
                <BuildingIcon class="size-3 shrink-0 text-ink-extra-muted" />
              </Show>
              <h3 class="truncate text-xs font-semibold text-ink">
                {props.channel.name}
              </h3>
            </div>
            <span class="flex items-center gap-1.5 text-xxs text-ink-extra-muted">
              <UsersIcon class="size-3" />
              {props.channel.participantCount}
            </span>
          </div>
        </div>
        <Show when={props.channel.unreadCount > 0}>
          <span class="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md bg-accent px-1.5 text-xxs font-semibold text-surface">
            {props.channel.unreadCount}
          </span>
        </Show>
      </div>

      <div class="relative mt-2 flex min-w-0 flex-col gap-1 @md/recent-channels:mt-0">
        <div class="pointer-events-none absolute bottom-0 right-0 opacity-0 transition group-hover:opacity-100">
          <Layer depth={3} class="rounded-xl">
            <div class="flex size-8 items-center justify-center rounded-xl bg-hover text-ink-muted transition group-hover:text-ink">
              <ArrowRightIcon class="size-4" />
            </div>
          </Layer>
        </div>
        <Show when={senderLabel()}>
          {(label) => (
            <div class="flex items-center gap-1.5 text-xxs font-medium text-ink-muted">
              <Show when={props.channel.latest.senderId}>
                {(senderId) => (
                  <UserIcon
                    id={senderId()}
                    size="sm"
                    suppressClick
                    showTooltip={false}
                  />
                )}
              </Show>
              <Tooltip label={label()}>
                <span class="min-w-0 truncate">{label()}</span>
              </Tooltip>
              <span class="shrink-0 text-ink-extra-muted/70">
                {props.channel.updatedAt}
              </span>
            </div>
          )}
        </Show>
        <div class="line-clamp-2 text-xs/5 text-ink-muted [&_*]:text-xs [&_*]:leading-5">
          <StaticMarkdown
            markdown={props.channel.latest.content}
            theme={compactMarkdownTheme}
          />
        </div>
      </div>
    </button>
  );
}

export function RecentChannelsSection() {
  const notificationSource = useGlobalNotificationSource();
  const currentUserId = useUserId();
  const splitLayout = useSplitLayout();

  const unreadByChannelId = createMemo(() => {
    const counts = new Map<string, number>();
    for (const notification of notificationSource.notifications()) {
      if (
        notification.entity_type !== 'channel' ||
        notification.done ||
        notification.viewed_at
      ) {
        continue;
      }
      counts.set(
        notification.entity_id,
        (counts.get(notification.entity_id) ?? 0) + 1
      );
    }
    return counts;
  });

  const channelsQuery = useSoupItemsQuery(
    () => ({
      params: { limit: 50, sort_method: 'viewed_updated' },
      body: {
        call_filters: { call_ids: ['00000000-0000-0000-0000-000000000000'] },
        chat_filters: { chat_ids: ['00000000-0000-0000-0000-000000000000'] },
        document_filters: {
          document_ids: ['00000000-0000-0000-0000-000000000000'],
        },
        email_filters: {
          email_thread_ids: ['00000000-0000-0000-0000-000000000000'],
        },
        project_filters: {
          project_ids: ['00000000-0000-0000-0000-000000000000'],
        },
        channel_filters: {
          channel_types: [
            'public',
            'organization',
            'private',
            'team',
            'direct_message',
          ],
        },
      },
    }),
    () => ({ staleTime: 5 * 60 * 1000 })
  );

  const shouldShowChannel = (entity: EntityData): entity is ChannelEntity => {
    if (entity.type !== 'channel') return false;

    return (
      entity.channelType === ChannelType.direct_message ||
      !!entity.latestMessage?.threadId ||
      !!entity.interactedAt
    );
  };

  const getDmUserId = (channel: ChannelEntity) => {
    if (channel.channelType !== ChannelType.direct_message) return;

    return (
      channel.participantIds?.find((id) => id !== currentUserId()) ??
      channel.latestMessage?.senderId
    );
  };

  const channels = createMemo(() => {
    const visibleChannels = (channelsQuery.data ?? [])
      .filter(shouldShowChannel)
      .slice(0, 10);

    return visibleChannels.map((channel) => {
      const latestMessage = channel.latestMessage;

      const latest = {
        content: latestMessage?.content?.trim() ?? 'No recent messages',
        senderId: latestMessage?.senderId,
        messageId: latestMessage?.messageId,
        threadId: latestMessage?.threadId,
      };

      const updatedAt = formatDate(
        channel.interactedAt ?? latestMessage?.createdAt ?? channel.updatedAt,
        { shortWeekday: true }
      );

      return {
        id: channel.id,
        name: channelDisplayName(channel.name),
        type: channel.channelType,
        latest,
        updatedAt,
        unreadCount: unreadByChannelId().get(channel.id) ?? 0,
        participantCount: channel.participantIds?.length ?? 0,
        dmUserId: getDmUserId(channel),
      };
    });
  });

  const openChannel = (channelId: string, event: MouseEvent) => {
    const channel = channels().find((item) => item.id === channelId);
    const params = channel?.latest.messageId
      ? getChannelParams(channel.latest.messageId, channel.latest.threadId)
      : undefined;

    splitLayout.openWithSplit(
      { type: 'channel' as const, id: channelId, params },
      {
        activate: true,
        preferNewSplit: event.shiftKey,
        referredFrom: 'dashboard',
      }
    );
  };

  const openChannelsView = (event: MouseEvent) => {
    splitLayout.openWithSplit(
      { type: 'component' as const, id: 'channels' },
      {
        activate: true,
        preferNewSplit: event.shiftKey,
        referredFrom: 'dashboard',
      }
    );
  };

  return (
    <section class="@container/recent-channels">
      <div class="mb-4 flex items-center justify-between gap-4 px-4 sm:px-0">
        <h2 class="text-lg font-semibold tracking-tight text-ink">
          Recent conversations
        </h2>
        <Button
          variant="ghost"
          size="sm"
          class="rounded-lg"
          onClick={openChannelsView}
        >
          View all
          <ArrowRightIcon class="size-4" />
        </Button>
      </div>

      <AdaptiveScroller scrollAmount={280} class="relative">
        <AdaptiveScroller.Viewport class="w-full scroll-pl-4 px-4 pb-1 sm:px-0 @md/recent-channels:grid @md/recent-channels:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] @md/recent-channels:gap-3 @md/recent-channels:overflow-visible @md/recent-channels:pb-0">
          <Show
            when={!channelsQuery.isLoading}
            fallback={
              <For each={[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]}>
                {() => (
                  <div class="skeleton-shimmer h-28 w-64 shrink-0 snap-start rounded-2xl border border-edge-muted bg-hover/60 p-3 @md/recent-channels:h-36 @md/recent-channels:w-auto">
                    <div class="skeleton-shimmer size-9 rounded-xl bg-surface" />
                    <div class="flex flex-col gap-2 pt-6">
                      <div class="skeleton-shimmer h-3 w-3/4 rounded-full bg-ink/10" />
                      <div class="skeleton-shimmer h-2.5 w-1/2 rounded-full bg-ink/5" />
                    </div>
                  </div>
                )}
              </For>
            }
          >
            <StaticMarkdownContext>
              <For each={channels().slice(0, 10)}>
                {(channel) => (
                  <ChannelCard channel={channel} onOpen={openChannel} />
                )}
              </For>
            </StaticMarkdownContext>
          </Show>
        </AdaptiveScroller.Viewport>
        <AdaptiveScroller.FadeEdges class="bottom-10 top-0 hidden sm:block @md/recent-channels:hidden" />
        <AdaptiveScroller.Controls class="mt-2 @md/recent-channels:hidden">
          <AdaptiveScroller.Control
            direction="left"
            class="hidden sm:inline-flex @md/recent-channels:hidden"
          />
          <AdaptiveScroller.Control
            direction="right"
            class="hidden sm:inline-flex @md/recent-channels:hidden"
          />
        </AdaptiveScroller.Controls>
      </AdaptiveScroller>
    </section>
  );
}
