import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { useSplitLayout } from '@app/component/split-layout/layout';
import {
  StaticMarkdown,
  StaticMarkdownContext,
} from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { UserIcon } from '@core/component/UserIcon';
import { useUserId } from '@core/context/user';
import { formatDate } from '@core/util/date';
import {
  createTheme,
  theme as markdownTheme,
} from '@core/component/LexicalMarkdown/theme';
import { useDisplayName } from '@core/user/displayName';
import type { ChannelEntity } from '@entity';
import { useSoupItemsQuery } from '@queries/soup/items';
import { ChannelType } from '@service-comms/generated/models/channelType';
import BuildingIcon from '@phosphor/building.svg';
import ArrowRightIcon from '@phosphor/arrow-right.svg';
import UsersIcon from '@phosphor/users.svg';
import { Avatar, Button, Layer, Tooltip } from '@ui';
import { createMemo, For, Show } from 'solid-js';

const compactMarkdownTheme = createTheme(
  {
    paragraph: 'm-0 md-p text-[1em]',
    list: {
      listitem: 'm-0',
    },
  },
  markdownTheme
);

type ChannelCardData = {
  id: string;
  name: string;
  type: string;
  latest: string;
  latestFromMe: boolean;
  latestSenderId?: string;
  updatedAt: string;
  unreadCount: number;
  participantCount: number;
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
  const [senderName] = useDisplayName(props.channel.latestSenderId as any);
  const senderLabel = () =>
    props.channel.latestSenderId
      ? props.channel.latestFromMe
        ? 'You'
        : senderName()
      : undefined;

  return (
    <button
      class="group flex min-h-20 w-64 shrink-0 snap-start flex-col justify-between rounded-2xl border border-edge-muted bg-hover/60 p-3 text-left transition hover:border-edge hover:bg-hover focus:outline-none focus-visible:border-accent @md/recent-channels:h-36 @md/recent-channels:w-auto @md/recent-channels:min-w-0"
      onClick={(event) => props.onOpen(props.channel.id, event)}
    >
      <div class="flex items-start justify-between gap-3">
        <div class="flex min-w-0 items-center gap-3">
          <Avatar size="md" class="bg-default/20 px-1 text-default @md/recent-channels:size-10">
            <Avatar.Fallback>{initials(props.channel.name)}</Avatar.Fallback>
          </Avatar>
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
              <Show when={props.channel.latestSenderId}>
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
            markdown={props.channel.latest}
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
      params: { limit: 6, sort_method: 'viewed_updated' },
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
          channel_types: ['public', 'organization', 'private', 'team'],
        },
      },
    }),
    () => ({ staleTime: 5 * 60 * 1000 })
  );

  const channels = createMemo<ChannelCardData[]>(() =>
    ((channelsQuery.data ?? []).filter(
      (entity): entity is ChannelEntity => entity.type === 'channel'
    ) as ChannelEntity[]).map((channel) => {
      const latest = channel.latestMessage;
      const latestFromMe = latest?.senderId === currentUserId();
      const latestText = latest?.content?.trim();

      return {
        id: channel.id,
        name: channelDisplayName(channel.name),
        type: channel.channelType,
        latest: latestText ?? 'No recent messages',
        latestFromMe,
        latestSenderId: latest?.senderId,
        updatedAt: formatDate(
          channel.interactedAt ?? latest?.createdAt ?? channel.updatedAt,
          { shortWeekday: true }
        ),
        unreadCount: unreadByChannelId().get(channel.id) ?? 0,
        participantCount: channel.participantIds?.length ?? 0,
      };
    })
  );

  const openChannel = (channelId: string, event: MouseEvent) => {
    splitLayout.openWithSplit(
      { type: 'channel' as const, id: channelId },
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
          Recent channels
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

      <div class="flex w-full snap-x scroll-pl-4 gap-2 overflow-x-auto px-4 pb-1 scrollbar-hidden @md/recent-channels:grid @md/recent-channels:grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] @md/recent-channels:gap-3 @md/recent-channels:overflow-visible @md/recent-channels:px-0 @md/recent-channels:pb-0">
        <Show
          when={!channelsQuery.isLoading}
          fallback={
            <For each={[0, 1, 2, 3, 4, 5, 6]}>
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
            <For each={channels()}>
              {(channel) => (
                <ChannelCard channel={channel} onOpen={openChannel} />
              )}
            </For>

          </StaticMarkdownContext>
        </Show>
      </div>
    </section>
  );
}
