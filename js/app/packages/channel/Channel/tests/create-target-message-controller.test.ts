import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createTargetMessageController,
  restoreDefaultChannelPaginationAfterTargetLoad,
} from '../create-target-message-controller';
import { queryClient } from '@queries/client';
import {
  getChannelMessagesQueryKey,
  type ChannelMessagesData,
} from '@queries/channel/channel-messages';

afterEach(() => {
  queryClient.clear();
});

function createController(
  input?: Partial<{
    channelId: string;
    initialTargetMessageId: string;
    messageKeys: string[];
    scrollToId: (messageId: string) => boolean;
    withNavigation: boolean;
  }>
) {
  const [messageKeys, setMessageKeys] = createSignal(input?.messageKeys ?? []);

  const scrollToId =
    input?.scrollToId ??
    (() => {
      return true;
    });

  const controller = createTargetMessageController({
    channelId: () => input?.channelId ?? 'channel-1',
    initialTargetMessageId: input?.initialTargetMessageId,
    messageKeys,
    navigation: () =>
      input?.withNavigation
        ? {
            scrollTo: () => false,
            scrollToIndex: () => false,
            scrollByDelta: () => false,
            scrollToTop: () => false,
            scrollToBottom: () => false,
            scrollToId,
            navigatePrevious: () => false,
            navigateNext: () => false,
            isNearBottom: () => true,
            markUserIntent: () => {},
          }
        : undefined,
  });

  return {
    controller,
    setMessageKeys,
  };
}

describe('createTargetMessageController', () => {
  it('preserves the current load-around target when navigating to an already loaded message', () => {
    createRoot((dispose) => {
      const { controller } = createController({
        initialTargetMessageId: 'message-1',
        messageKeys: ['message-2'],
      });

      controller.goToMessage('message-2');

      expect(controller.activeTargetMessageId()).toBe('message-2');
      expect(controller.highlightedMessageId()).toBe('message-2');
      expect(controller.pendingScrollTargetId()).toBe('message-2');
      expect(controller.loadAroundMessageId()).toBeUndefined();
      dispose();
    });
  });

  it('switches load-around target when navigating to a missing message', () => {
    createRoot((dispose) => {
      const { controller } = createController({
        initialTargetMessageId: 'message-1',
      });

      controller.goToMessage('message-9');

      expect(controller.activeTargetMessageId()).toBe('message-9');
      expect(controller.highlightedMessageId()).toBe('message-9');
      expect(controller.pendingScrollTargetId()).toBe('message-9');
      expect(controller.loadAroundMessageId()).toBe('message-9');
      dispose();
    });
  });

  it('copies around-target query data into the default query key', () => {
    const aroundData = {
      pageParams: [null],
      pages: [
        {
          items: [],
          next_cursor: 'next',
          previous_cursor: 'prev',
        },
      ],
    } as ChannelMessagesData;

    queryClient.setQueryData(
      getChannelMessagesQueryKey('channel-1', 'message-9'),
      aroundData
    );

    restoreDefaultChannelPaginationAfterTargetLoad('channel-1', 'message-9');

    expect(
      queryClient.getQueryData(getChannelMessagesQueryKey('channel-1', null))
    ).toEqual(aroundData);
  });
});
