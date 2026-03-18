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
};

export function createTargetMessageController(
  options: CreateTargetMessageControllerOptions
) {
  const initialTargetMessageData: TargetMessageData = {
    activeTargetMessageId: options.initialTargetMessageId,
    activeTargetMessageReplyId: undefined,
    highlightedMessageId:
      options.initialTargetMessageReplyId ?? options.initialTargetMessageId,
    loadAroundMessageId: options.initialTargetMessageId,
    pendingScrollTargetId: options.initialTargetMessageId,
  };

  const [targetMessageData, setTargetMessageData] =
    createStore<TargetMessageData>(initialTargetMessageData);

  const hasMessageLoaded = (messageId: string) =>
    options.messageKeys().includes(messageId);

  const goToMessage = (messageId: string, replyId?: string) => {
    const isSameTarget =
      targetMessageData['activeTargetMessageId'] === messageId;
    const isPending = targetMessageData['pendingScrollTargetId'] === messageId;

    if (isSameTarget && isPending) return;

    setTargetMessageData({
      activeTargetMessageId: messageId,
      activeTargetMessageReplyId: replyId,
      highlightedMessageId: replyId ?? messageId,
      loadAroundMessageId: hasMessageLoaded(messageId) ? undefined : messageId,
      pendingScrollTargetId: messageId,
    });
  };

  const completePendingScroll = (messageId: string) => {
    if (targetMessageData['pendingScrollTargetId'] !== messageId) return;
    setTargetMessageData('pendingScrollTargetId', undefined);
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

    goToMessage,
    completePendingScroll,
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
  return true;
}
