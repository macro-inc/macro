import { createEffect, on, type Accessor } from 'solid-js';
import {
  getChannelMessagesQueryKey,
  type ChannelMessagesData,
} from '@queries/channel/channel-messages';
import { queryClient } from '@queries/client';
import type { ThreadListNavigation } from './ThreadList';
import { createStore } from 'solid-js/store';

type CreateTargetMessageControllerOptions = {
  channelId: Accessor<string>;
  initialTargetMessageId?: string | undefined;
  initialTargetMessageReplyId?: string | undefined;
  messageKeys: Accessor<string[]>;
  navigation: Accessor<ThreadListNavigation | undefined>;
};

export type TargetMessageController = ReturnType<
  typeof createTargetMessageController
>;

type TargetMessageData = {
  activeTargetMessageId: string | undefined;
  activeTargetMessageReplyId: string | undefined;
  highlightedMessageId: string | undefined;
  loadAroundMessageId: string | undefined;
  pendingScrollTargetId: string | undefined;
  pendingTargetReplyId: string | undefined;
};

export function createTargetMessageController(
  options: CreateTargetMessageControllerOptions
) {
  const initialTargetMessageData: TargetMessageData = {
    activeTargetMessageId: options.initialTargetMessageId,
    activeTargetMessageReplyId: options.initialTargetMessageReplyId,
    highlightedMessageId:
      options.initialTargetMessageReplyId ?? options.initialTargetMessageId,
    loadAroundMessageId: options.initialTargetMessageId,
    pendingScrollTargetId: options.initialTargetMessageId,
    pendingTargetReplyId: options.initialTargetMessageReplyId,
  };

  const [targetMessageData, setTargetMessageData] =
    createStore<TargetMessageData>(initialTargetMessageData);

  const hasMessageLoaded = (messageId: string) =>
    options.messageKeys().includes(messageId);

  const goToMessage = (messageId: string, replyId?: string) => {
    const isSameTarget =
      targetMessageData['activeTargetMessageId'] === messageId;
    const isSameReplyTarget =
      targetMessageData['activeTargetMessageReplyId'] === replyId;
    const isPending = targetMessageData['pendingScrollTargetId'] === messageId;

    if (isSameTarget && isSameReplyTarget && isPending) return;

    setTargetMessageData({
      activeTargetMessageId: messageId,
      activeTargetMessageReplyId: replyId,
      highlightedMessageId: replyId ?? messageId,
      loadAroundMessageId: hasMessageLoaded(messageId) ? undefined : messageId,
      pendingScrollTargetId: messageId,
      pendingTargetReplyId: replyId,
    });
  };

  const completePendingScroll = (messageId: string) => {
    if (targetMessageData['pendingScrollTargetId'] !== messageId) return;
    setTargetMessageData('pendingScrollTargetId', undefined);
  };

  const completePendingReplyScroll = (messageId: string, replyId: string) => {
    if (targetMessageData['activeTargetMessageId'] !== messageId) return;
    if (targetMessageData['pendingTargetReplyId'] !== replyId) return;
    setTargetMessageData('pendingTargetReplyId', undefined);
  };

  createEffect(
    on(
      [
        options.navigation,
        () => targetMessageData['pendingScrollTargetId'],
        options.messageKeys,
      ],
      ([navigation, pendingTargetId]) => {
        if (!navigation || !pendingTargetId) return;
        if (!hasMessageLoaded(pendingTargetId)) return;
        if (!navigation.scrollToId(pendingTargetId)) return;

        const restoredDefaultPagination =
          restoreDefaultChannelPaginationAfterTargetLoad(
            options.channelId(),
            targetMessageData['loadAroundMessageId']
          );
        if (restoredDefaultPagination) {
          setTargetMessageData('loadAroundMessageId', undefined);
        }
        completePendingScroll(pendingTargetId);
      }
    )
  );

  return {
    activeTargetMessageId: () => targetMessageData['activeTargetMessageId'],
    activeTargetMessageReplyId: () =>
      targetMessageData['activeTargetMessageReplyId'],
    highlightedMessageId: () => targetMessageData['highlightedMessageId'],
    loadAroundMessageId: () => targetMessageData['loadAroundMessageId'],
    pendingScrollTargetId: () => targetMessageData['pendingScrollTargetId'],
    pendingTargetReplyId: () => targetMessageData['pendingTargetReplyId'],

    goToMessage,
    completePendingScroll,
    completePendingReplyScroll,
  };
}

export function restoreDefaultChannelPaginationAfterTargetLoad(
  channelId: string,
  loadAroundMessageId: string | undefined
) {
  if (!loadAroundMessageId) return false;

  const aroundKey = getChannelMessagesQueryKey(channelId, loadAroundMessageId);
  const defaultKey = getChannelMessagesQueryKey(channelId, null);
  const aroundData = queryClient.getQueryData<ChannelMessagesData>(aroundKey);
  if (!aroundData) return false;

  queryClient.setQueryData(defaultKey, aroundData);
  // Remove the around-query variant so it doesn't linger in cache across
  // component mounts.
  queryClient.removeQueries({ queryKey: aroundKey });
  return true;
}

/**
 * When opening a channel without a target, the default query may still hold
 * stale data that was restored from a previous load-around session. A normal
 * latest-messages load never has `previous_cursor` on its first page (there
 * are no newer messages). If we detect that cursor, the data is stale and
 * centered on an old target — remove it so the query fetches from the bottom.
 */
export function clearStaleRestoredChannelData(channelId: string) {
  const defaultKey = getChannelMessagesQueryKey(channelId, null);
  const cached = queryClient.getQueryData<ChannelMessagesData>(defaultKey);
  if (!cached?.pages.length) return;

  // First page (index 0) is the newest page in the infinite query.
  // A genuine latest-messages fetch never has previous_cursor on its
  // first page because there are no newer messages.
  if (cached.pages[0].previous_cursor) {
    queryClient.removeQueries({ queryKey: defaultKey });
  }
}
