import { ViewSidebar } from '@app/components/view-shell';
import { channelListName } from '@app/features/channel/group-chat-name';
import { ChannelAvatar } from '@app/features/channels-view/components/rail/ChannelRailItems';
import {
  type ChannelsSourceScope,
  useChannelsSources,
} from '@app/features/channels-view/queries';
import { t } from '@app/lib/i18n';
import { useSplitRouter } from '@app/lib/split-router';
import { channelDetailRoute } from '@app/routes/routes';
import { globalSplitManager } from '@app/signal/splitLayout';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import type { ChannelEntity } from '@entity';
import { UnreadIndicator } from '@entity/components/UnreadIndicator';
import { For, Show } from 'solid-js';
import { useSplitLayout } from '../split-layout/layout';

/** Each section lists at most this many conversations. */
const SECTION_LIMIT = 10;

const LISTED_SCOPES: ChannelsSourceScope[] = [
  'channels',
  'team_channels',
  'direct_messages',
];

/**
 * Chat's navigation in the single sidebar: group chats and direct messages,
 * each its unread conversations first, then the most recently active, from
 * the same bounded sources as the Chat list.
 */
export function ChatSections() {
  const layout = useSplitLayout();
  const router = useSplitRouter();
  const notificationSource = useGlobalNotificationSource();
  const sources = useChannelsSources(
    (scope) => LISTED_SCOPES.includes(scope),
    () => 'updated_at'
  );

  // The same unread rule as the Chat list: an unseen message notification,
  // with the viewer's local reads applied.
  const isUnread = (channel: ChannelEntity) =>
    (channel.unreadNotifications ?? []).some(
      (notification) =>
        (notificationSource.withLocalState?.(notification) ??
          notification.state) === 'unseen'
    );

  // Sources arrive sorted by latest activity; a stable partition keeps that
  // order within the unread and the read rows.
  const pick = (channels: readonly ChannelEntity[]) => {
    const unread = channels.filter(isUnread);
    const read = channels.filter((channel) => !isUnread(channel));
    return [...unread, ...read].slice(0, SECTION_LIMIT);
  };

  const groupChats = () =>
    pick(
      [...sources.channels.items(), ...sources.team_channels.items()].sort(
        (a, b) => activityTime(b) - activityTime(a)
      )
    );
  const directMessages = () => pick(sources.direct_messages.items());

  // The split shows a conversation as Chat's route with its id, not as
  // channel content, so read the active pane's route.
  const openChannelId = () => {
    const split = globalSplitManager()?.activeSplit();
    const pane = router.panes().find((pane) => pane.toString() === split?.id);
    if (!pane) return undefined;
    const match = router
      .entry(pane)
      ?.location.route.matches.find(
        (match) => match.id === channelDetailRoute.id
      );
    const id = match?.params.channelId;
    return typeof id === 'string' ? id : undefined;
  };
  const isOpen = (channel: ChannelEntity) => openChannelId() === channel.id;

  const open = (channel: ChannelEntity, event: MouseEvent) => {
    layout.openWithSplit(
      { type: 'channel', id: channel.id },
      { preferNewSplit: event.shiftKey, referredFrom: 'sidebar' }
    );
  };

  const section = (label: string, channels: () => ChannelEntity[]) => (
    <Show when={channels().length > 0}>
      <ViewSidebar.Nav aria-label={label}>
        <h3 class="flex h-6 shrink-0 items-center px-(--sidebar-item-inset) text-xs font-medium text-ink-muted">
          {label}
        </h3>
        <For each={channels()}>
          {(channel) => (
            <ViewSidebar.Item
              active={isOpen(channel)}
              class="cursor-default"
              data-unread={isUnread(channel) ? '' : undefined}
              onClick={(event) => open(channel, event)}
            >
              <ViewSidebar.Icon>
                <ChannelAvatar channel={channel} />
              </ViewSidebar.Icon>
              <span
                class={
                  isUnread(channel)
                    ? 'min-w-0 flex-1 truncate text-ink'
                    : 'min-w-0 flex-1 truncate'
                }
              >
                {channelListName(channel)}
              </span>
              <Show when={isUnread(channel)}>
                <span aria-hidden="true" class="flex size-3.5 items-center">
                  <UnreadIndicator active class="size-1.5" />
                </span>
              </Show>
            </ViewSidebar.Item>
          )}
        </For>
      </ViewSidebar.Nav>
    </Show>
  );

  return (
    <div class="flex flex-col gap-(--sidebar-section-gap) px-(--sidebar-gutter) py-2">
      {section(t('nav.groupChats'), groupChats)}
      {section(t('nav.directMessages'), directMessages)}
    </div>
  );
}

function activityTime(channel: ChannelEntity) {
  const value = channel.updatedAt ?? channel.interactedAt;
  return value ? new Date(value).getTime() : 0;
}
