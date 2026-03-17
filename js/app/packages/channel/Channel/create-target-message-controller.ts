import {
  createEffect,
  createSignal,
  on,
  type Accessor,
} from 'solid-js';
import {
  getChannelMessagesQueryKey,
  type ChannelMessagesData,
} from '@queries/channel/channel-messages';
import { queryClient } from '@queries/client';
import type { ThreadListNavigation } from './ThreadList';

type CreateTargetMessageControllerOptions = {
  channelId: Accessor<string>;
  initialTargetMessageId?: string | undefined;
  messageKeys: Accessor<string[]>;
  navigation: Accessor<ThreadListNavigation | undefined>;
};

export type TargetMessageController = ReturnType<
  typeof createTargetMessageController
>;

export function createTargetMessageController(
  options: CreateTargetMessageControllerOptions
) {
  const initialTargetMessageId = options.initialTargetMessageId;

  const [activeTargetMessageId, setActiveTargetMessageId] = createSignal<
    string | undefined
  >(initialTargetMessageId);
  const [highlightedMessageId, setHighlightedMessageId] = createSignal<
    string | undefined
  >(initialTargetMessageId);
  const [loadAroundMessageId, setLoadAroundMessageId] = createSignal<
    string | undefined
  >(initialTargetMessageId);
  const [pendingScrollTargetId, setPendingScrollTargetId] = createSignal<
    string | undefined
  >(initialTargetMessageId);

  const hasMessageLoaded = (messageId: string) =>
    options.messageKeys().includes(messageId);

  const goToMessage = (messageId: string | undefined) => {
    if (!messageId) return;

    const isSameTarget = activeTargetMessageId() === messageId;
    const isPending = pendingScrollTargetId() === messageId;

    if (isSameTarget && isPending) return;

    setActiveTargetMessageId(messageId);
    setHighlightedMessageId(messageId);
    setPendingScrollTargetId(messageId);

    if (hasMessageLoaded(messageId)) return;

    setLoadAroundMessageId(messageId);
  };

  const completePendingScroll = (messageId: string) => {
    if (pendingScrollTargetId() !== messageId) return;
    setPendingScrollTargetId(undefined);
  };

  createEffect(
    on(
      [options.navigation, pendingScrollTargetId, options.messageKeys],
      ([navigation, pendingTargetId]) => {
        if (!navigation || !pendingTargetId) return;
        if (!hasMessageLoaded(pendingTargetId)) return;
        if (!navigation.scrollToId(pendingTargetId)) return;

        const restoredDefaultPagination =
          restoreDefaultChannelPaginationAfterTargetLoad(
            options.channelId(),
            loadAroundMessageId()
          );
        if (restoredDefaultPagination) {
          setLoadAroundMessageId(undefined);
        }
        completePendingScroll(pendingTargetId);
      }
    )
  );

  return {
    activeTargetMessageId,
    highlightedMessageId,
    loadAroundMessageId,
    pendingScrollTargetId,
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
