import {
  channelDisplayName,
  compactMarkdownTheme,
} from '@app/component/dashboard/utils';
import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import { useSplitLayout } from '@app/component/split-layout/layout';
import { getChannelParams } from '@channel/Channel/link';
import {
  EntityIcon,
  type EntityIconSelector,
} from '@core/component/EntityIcon';
import {
  StaticMarkdown,
  StaticMarkdownContext,
} from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
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
  invalidateSoupEntity,
  refetchSoupEntity,
} from '@queries/soup/normalized-cache';
import { ChannelType } from '@service-storage/generated/schemas';
import { Button, Scroll, Tooltip } from '@ui';
import { createMemo, For, Show } from 'solid-js';

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

  const conversationIcon = () => (
    <Show
      when={props.conversation.dmUserId}
      fallback={
        <div class="row-start-1 flex size-6 shrink-0 items-center justify-center self-center text-ink-muted transition group-hover:text-ink">
          <EntityIcon
            targetType={
              (props.conversation.type || 'channel') as EntityIconSelector
            }
            size="xs"
            class="shrink-0"
          />
        </div>
      }
    >
      {(dmUserId) => (
        <UserIcon
          id={dmUserId()}
          size="sm"
          suppressClick
          showTooltip={false}
          class="row-start-1 shrink-0 self-center"
        />
      )}
    </Show>
  );

  return (
    <button
      class="group grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[auto_auto_auto] gap-x-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-active/60 hover:ring hover:ring-edge hover:ring-inset focus:outline-none focus-visible:bg-active/60 focus-visible:ring focus-visible:ring-edge focus-visible:ring-inset"
      onClick={(event) => props.onOpen(props.conversation.id, event)}
    >
      {conversationIcon()}

      <div class="col-start-2 row-start-1 flex min-w-0 items-center gap-1.5">
        <Tooltip label={props.conversation.name}>
          <h3 class="min-w-0 truncate text-sm font-medium text-ink">
            {props.conversation.name}
          </h3>
        </Tooltip>
      </div>

      <Show when={senderLabel()}>
        {(label) => (
          <span class="col-start-2 row-start-2 min-w-0 truncate text-xs text-ink">
            {label()}
          </span>
        )}
      </Show>

      <div class="col-start-2 col-end-4 row-start-3 line-clamp-2 min-w-0 text-xs text-ink-extra-muted">
        <StaticMarkdown
          markdown={props.conversation.latest.content}
          theme={compactMarkdownTheme}
        />
      </div>

      <div class="col-start-3 row-start-1 flex items-center gap-1.5 self-center">
        <Show when={props.conversation.unreadCount > 0}>
          <span class="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-sm bg-accent px-1 text-xxs font-bold text-surface">
            {props.conversation.unreadCount}
          </span>
        </Show>
        <span class="shrink-0 text-xxs text-ink-extra-muted">
          {props.conversation.updatedAt}
        </span>
      </div>
    </button>
  );
}

export function useRecentConversations(limit: number = 10) {
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
          channel_types: ['public', 'private', 'team', 'direct_message'],
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
      .slice(0, limit);

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

export function RecentConversationsList() {
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
        <div class="flex flex-col gap-0.5">
          <For each={[0, 1, 2]}>
            {() => <div class="h-9 rounded-lg bg-hover" />}
          </For>
        </div>
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
          <div class="flex flex-col gap-0.5">
            <For each={conversations()}>
              {(conversation) => (
                <RecentConversationCard
                  conversation={conversation}
                  onOpen={(_, event) => openConversation(conversation, event)}
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

      <div class="max-h-80 px-4 pb-1 sm:px-0">
        <Scroll>
          <RecentConversationsList />
        </Scroll>
      </div>
    </section>
  );
}
