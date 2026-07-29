import { queryClient } from '@queries/client';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@service-storage/client', () => ({
  storageServiceClient: {},
}));

import {
  type ChannelMessagesData,
  getChannelMessagesQueryKey,
} from '@queries/channel/channel-messages';
import {
  createTargetMessageController,
  restoreDefaultChannelPaginationAfterTargetLoad,
} from '../create-target-message-controller';

afterEach(() => {
  queryClient.clear();
});

function createController(
  input?: Partial<{
    channelId: string;
    initialTargetMessageId: string;
    initialTargetMessageReplyId: string;
    messageKeys: string[];
    scrollToId: (messageId: string) => boolean;
    withNavigation: boolean;
    didInitialScroll: boolean;
  }>
) {
  const [messageKeys, setMessageKeys] = createSignal(input?.messageKeys ?? []);
  const [didInitialScroll, setDidInitialScroll] = createSignal(
    input?.didInitialScroll ?? false
  );

  const scrollToId =
    input?.scrollToId ??
    (() => {
      return true;
    });

  const controller = createTargetMessageController({
    channelId: () => input?.channelId ?? 'channel-1',
    initialTargetMessageId: input?.initialTargetMessageId,
    initialTargetMessageReplyId: input?.initialTargetMessageReplyId,
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
            scrollToElementInItem: () => true,
            markUserIntent: () => {},
          }
        : undefined,
    didInitialScroll,
  });

  return {
    controller,
    setMessageKeys,
    setDidInitialScroll,
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
      expect(controller.pendingScrollTargetId()).toBe('message-2');
      expect(controller.loadAroundMessageId()).toBe('message-1');
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
      expect(controller.pendingScrollTargetId()).toBe('message-9');
      expect(controller.loadAroundMessageId()).toBe('message-9');
      dispose();
    });
  });

  it('lets a nested reply perform the only viewport scroll', async () => {
    const scrollToId = vi.fn(() => true);
    let dispose = () => {};
    let controller: ReturnType<typeof createTargetMessageController>;

    createRoot((rootDispose) => {
      dispose = rootDispose;
      controller = createController({
        initialTargetMessageId: 'message-1',
        initialTargetMessageReplyId: 'reply-4',
        messageKeys: ['message-1'],
        scrollToId,
        withNavigation: true,
        didInitialScroll: true,
      }).controller;
    });

    await Promise.resolve();

    expect(scrollToId).not.toHaveBeenCalled();
    expect(controller!.pendingScrollTargetId()).toBeUndefined();
    expect(controller!.pendingTargetReplyId()).toBe('reply-4');
    dispose();
  });

  it('keeps a root target pending until its element is positioned within the row', async () => {
    const scrollToId = vi.fn(() => true);
    let dispose = () => {};
    let controller: ReturnType<typeof createTargetMessageController>;

    createRoot((rootDispose) => {
      dispose = rootDispose;
      controller = createController({
        initialTargetMessageId: 'message-1',
        messageKeys: ['message-1'],
        scrollToId,
        withNavigation: true,
        didInitialScroll: true,
      }).controller;
    });

    await Promise.resolve();

    expect(scrollToId).not.toHaveBeenCalled();
    expect(controller!.pendingScrollTargetId()).toBe('message-1');

    controller!.completePendingScroll('message-1');
    expect(controller!.pendingScrollTargetId()).toBeUndefined();
    dispose();
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
