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
  /**
   * Whether the ThreadList has completed its initial scroll.
   *
   * The controller defers pending scroll execution until this returns `true`
   * so that a `goToMessage` call that fires while the initial scroll is still
   * in progress does not get overridden by the initial-scroll retry logic
   * inside ThreadList.
   */
  didInitialScroll: Accessor<boolean>;
};

export type TargetMessageController = ReturnType<
  typeof createTargetMessageController
>;

type TargetMessageData = {
  activeTargetMessageId: string | undefined;
  activeTargetMessageReplyId: string | undefined;
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
        options.didInitialScroll,
      ],
      ([navigation, pendingTargetId, , didInitialScroll]) => {
        if (!navigation || !pendingTargetId) return;
        if (!hasMessageLoaded(pendingTargetId)) return;

        // Defer the scroll until the ThreadList has completed its initial
        // scroll. This prevents a goToMessage call from being overridden by
        // the initial-scroll retry logic in ThreadList's handleScrollEnd,
        // which validates position against the *original* scroll target.
        // The pending target stays queued; once didInitialScroll flips to
        // true the effect re-fires and executes the scroll.
        if (!didInitialScroll) return;

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

  const reset = () => {
    setTargetMessageData({
      activeTargetMessageId: undefined,
      activeTargetMessageReplyId: undefined,
      loadAroundMessageId: undefined,
      pendingScrollTargetId: undefined,
      pendingTargetReplyId: undefined,
    });
  };

  return {
    activeTargetMessageId: () => targetMessageData['activeTargetMessageId'],
    activeTargetMessageReplyId: () =>
      targetMessageData['activeTargetMessageReplyId'],
    loadAroundMessageId: () => targetMessageData['loadAroundMessageId'],
    pendingScrollTargetId: () => targetMessageData['pendingScrollTargetId'],
    pendingTargetReplyId: () => targetMessageData['pendingTargetReplyId'],

    goToMessage,
    completePendingScroll,
    completePendingReplyScroll,
    reset,
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

  // Check both the page cursor AND pageParams[0]. After fetchPreviousPage,
  // pageParams[0] contains { previous_cursor } even if pages[0].previous_cursor
  // might be different. A fresh load should have pageParams[0] = null.
  const pageParams = cached.pageParams;
  const hasStalePageParams = pageParams?.[0] != null;
  const hasStalePageCursor = !!cached.pages[0].previous_cursor;

  if (hasStalePageParams || hasStalePageCursor) {
    queryClient.removeQueries({ queryKey: defaultKey });
  }
}
