import { AdaptiveScroller } from '@app/component/dashboard/adaptive-scroller';
import {
  channelDisplayName,
  compactMarkdownTheme,
} from '@app/component/dashboard/utils';
import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { useSplitLayout } from '@app/component/split-layout/layout';
import { getChannelParams } from '@channel/Channel/link';
import {
  StaticMarkdown,
  StaticMarkdownContext,
} from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { EntityIcon } from '@core/component/EntityIcon';
import { UserIcon } from '@core/component/UserIcon';
import { useUserId } from '@core/context/user';
import { useDisplayName } from '@core/user/displayName';
import { formatDate } from '@core/util/date';
import type { ChannelEntity, EntityData } from '@entity';
import {
  createEffectOnEntityTypeNotification,
  notificationIsRead,
} from '@notifications';
import ArrowRightIcon from '@phosphor/arrow-right.svg';
import { invalidateEntityNotifications } from '@queries/notification/user-notifications';
import { useSoupItemsQuery } from '@queries/soup/items';
import {
  refetchSoupEntity,
  invalidateSoupEntity,
} from '@queries/soup/normalized-cache';
import { Button, cn, Tooltip } from '@ui';
import { createMemo, For, Show } from 'solid-js';
import { ChannelType } from '@service-storage/generated/schemas';

export type RecentConversationCardData = {
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

export function RecentConversationCard(props: {
  conversation: RecentConversationCardData;
  onOpen: (conversationId: string, event: MouseEvent) => void;
  variant?: 'card' | 'row';
}) {
  const [senderName] = useDisplayName(
    props.conversation.latest.senderId as any
  );
  const currentUserId = useUserId();
  const senderLabel = () => {
    const senderId = props.conversation.latest.senderId;

    if (!senderId) return;
    if (senderId === currentUserId()) return 'You';

    return senderName();
  };
  const isCard = () => props.variant === 'card';

  return (
    <button
      class={cn(
        'group grid min-w-0 snap-start grid-cols-[auto_minmax(0,1fr)] grid-rows-[auto_1fr] gap-x-3 gap-y-1.5 rounded-xl text-left transition',
        isCard()
          ? 'w-72 shrink-0 border border-edge-muted bg-hover/40 p-2.5 hover:border-edge hover:bg-hover focus-visible:border-accent @md/recent-conversations:w-auto'
          : 'w-full p-2.5 hover:bg-active/60 hover:ring hover:ring-edge hover:ring-inset focus-visible:bg-active/60 focus-visible:ring focus-visible:ring-edge focus-visible:ring-inset',
        'focus:outline-none'
      )}
      onClick={(event) => props.onOpen(props.conversation.id, event)}
    >
      <Show
        when={props.conversation.dmUserId}
        fallback={
          <div class="col-start-1 row-span-2 row-start-1 flex size-9 shrink-0 items-center justify-center rounded-lg bg-hover text-ink-muted transition group-hover:bg-active group-hover:text-ink">
            <EntityIcon
              targetType={props.conversation.type || 'channel'}
              size="sm"
              class="shrink-0"
            />
          </div>
        }
      >
        {(dmUserId) => (
          <UserIcon
            id={dmUserId()}
            size="md"
            suppressClick
            showTooltip={false}
            class="col-start-1 row-span-2 row-start-1 shrink-0"
          />
        )}
      </Show>

      <div class="col-start-2 row-start-1 flex min-h-0 min-w-0 items-start justify-between gap-2">
        <div class="flex min-w-0 items-center gap-1.5">
          <h3 class="min-w-0 truncate text-sm font-medium text-ink">
            {props.conversation.name}
          </h3>
          <Show when={props.conversation.unreadCount > 0}>
            <span class="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-sm bg-accent px-1 text-xxs font-bold text-surface">
              {props.conversation.unreadCount}
            </span>
          </Show>
        </div>

        <div class="flex shrink-0 items-center gap-1.5 text-xxs text-ink-extra-muted">
          <span>{props.conversation.updatedAt}</span>
          <div class="hidden opacity-0 transition group-hover:opacity-100 @md/recent-conversations:block">
            <ArrowRightIcon class="size-3.5" />
          </div>
        </div>
      </div>

      <div class="col-start-2 row-start-2 flex min-w-0 flex-col gap-0.5 text-xs/5 text-ink-muted">
        <Show when={!props.conversation.dmUserId && senderLabel()}>
          {(label) => (
            <Tooltip label={label()}>
              <span class="min-w-0 truncate text-xs font-semibold text-ink-muted">
                {label()}
              </span>
            </Tooltip>
          )}
        </Show>
        <div class="line-clamp-2 min-w-0 [&_*]:text-xs [&_*]:leading-5">
          <StaticMarkdown
            markdown={props.conversation.latest.content}
            theme={compactMarkdownTheme}
          />
        </div>
      </div>
    </button>
  );
}

export function useRecentConversations() {
  const notificationSource = useGlobalNotificationSource();
  const currentUserId = useUserId();

  createEffectOnEntityTypeNotification(
    notificationSource,
    'channel',
    (notification) => {
      refetchSoupEntity(notification.entity_id, 'channel');
      invalidateSoupEntity(notification.entity_id);
      invalidateEntityNotifications(notification.entity_id);
    }
  );

  const unreadByChannelId = createMemo(() => {
    const counts = new Map<string, number>();
    for (const notification of notificationSource.notifications()) {
      if (
        notification.entity_type !== 'channel' ||
        notification.done ||
        notificationIsRead(notification)
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

    return visibleChannels.map((channel): RecentConversationCardData => {
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

  return {
    conversations: channels,
    isLoading: () => channelsQuery.isLoading,
  };
}

export function RecentConversationsList(props: { variant?: 'card' | 'row' }) {
  const { conversations, isLoading } = useRecentConversations();
  const splitLayout = useSplitLayout();

  const openConversation = (
    conversation: RecentConversationCardData,
    event: MouseEvent
  ) => {
    const params = conversation.latest.messageId
      ? getChannelParams(
          conversation.latest.messageId,
          conversation.latest.threadId
        )
      : undefined;

    splitLayout.openWithSplit(
      { type: 'channel' as const, id: conversation.id, params },
      {
        activate: true,
        preferNewSplit: event.shiftKey,
        referredFrom: 'dashboard',
      }
    );
  };

  return (
    <Show
      when={!isLoading()}
      fallback={
        props.variant === 'card' ? (
          <For each={[0, 1, 2, 3, 4, 5, 6, 7, 8, 9]}>
            {() => (
              <div class="skeleton-shimmer h-20 w-72 shrink-0 snap-start rounded-xl border border-edge-muted bg-hover/60 p-2.5 @md/recent-conversations:w-auto">
                <div class="skeleton-shimmer size-9 rounded-xl bg-surface" />
                <div class="flex flex-col gap-2 pt-6">
                  <div class="skeleton-shimmer h-3 w-3/4 rounded-full bg-ink/10" />
                  <div class="skeleton-shimmer h-2.5 w-1/2 rounded-full bg-ink/5" />
                </div>
              </div>
            )}
          </For>
        ) : (
          <div class="flex flex-col gap-1">
            <For each={[0, 1, 2]}>
              {() => <div class="h-16 rounded-lg bg-hover" />}
            </For>
          </div>
        )
      }
    >
      <Show
        when={conversations().length > 0}
        fallback={
          <div class="rounded-lg p-2.5 text-xs text-ink-muted">
            No recent conversations
          </div>
        }
      >
        <StaticMarkdownContext>
          <div
            class={cn(
              props.variant === 'card' ? 'contents' : 'flex flex-col gap-1'
            )}
          >
            <For each={conversations()}>
              {(conversation) => (
                <RecentConversationCard
                  conversation={conversation}
                  onOpen={(_, event) => openConversation(conversation, event)}
                  variant={props.variant}
                />
              )}
            </For>
          </div>
        </StaticMarkdownContext>
      </Show>
    </Show>
  );
}

export function RecentConversationsSection() {
  const splitLayout = useSplitLayout();

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
    <section class="@container/recent-conversations">
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
        <AdaptiveScroller.Viewport class="w-full scroll-pl-4 px-4 pb-1 sm:px-0 @md/recent-conversations:grid @md/recent-conversations:grid-cols-[repeat(auto-fit,minmax(16rem,1fr))] @md/recent-conversations:gap-3 @md/recent-conversations:overflow-visible @md/recent-conversations:pb-0">
          <RecentConversationsList variant="card" />
        </AdaptiveScroller.Viewport>
        <AdaptiveScroller.FadeEdges class="bottom-10 top-0 hidden sm:block @md/recent-conversations:hidden" />
        <AdaptiveScroller.Controls class="mt-2 @md/recent-conversations:hidden">
          <AdaptiveScroller.Control
            direction="left"
            class="hidden sm:inline-flex @md/recent-conversations:hidden"
          />
          <AdaptiveScroller.Control
            direction="right"
            class="hidden sm:inline-flex @md/recent-conversations:hidden"
          />
        </AdaptiveScroller.Controls>
      </AdaptiveScroller>
    </section>
  );
}
