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
  TARGETED_MESSAGE_FLASH_MS,
} from '../create-target-message-controller';

afterEach(() => {
  queryClient.clear();
  vi.useRealTimers();
});

function createController(
  input?: Partial<{
    channelId: string;
    initialTargetMessageId: string;
    initialTargetMessageReplyId: string;
    messageKeys: string[];
    withNavigation: boolean;
    didInitialScroll: boolean;
  }>
) {
  const [messageKeys, setMessageKeys] = createSignal(input?.messageKeys ?? []);
  const [didInitialScroll, setDidInitialScroll] = createSignal(
    input?.didInitialScroll ?? false
  );
  let dispose = () => {};
  let controller!: ReturnType<typeof createTargetMessageController>;

  createRoot((rootDispose) => {
    dispose = rootDispose;
    controller = createTargetMessageController({
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
              scrollToId: () => false,
              navigatePrevious: () => false,
              navigateNext: () => false,
              isNearBottom: () => true,
              scrollToElementInItem: () => true,
              markUserIntent: () => {},
            }
          : undefined,
      didInitialScroll,
    });
  });

  return {
    controller,
    dispose,
    setMessageKeys,
    setDidInitialScroll,
  };
}

describe('createTargetMessageController', () => {
  it('schedules a flash on entry and releases when it elapses', async () => {
    vi.useFakeTimers();
    const { controller, dispose } = createController({
      messageKeys: ['message-1'],
      withNavigation: true,
      didInitialScroll: true,
    });

    controller.goToMessage('message-1');
    await Promise.resolve();
    controller.completePendingScroll('message-1');

    expect(vi.getTimerCount()).toBe(1);
    expect(controller.activeTargetMessageId()).toBe('message-1');

    vi.advanceTimersByTime(TARGETED_MESSAGE_FLASH_MS);

    expect(controller.activeTargetMessageId()).toBeUndefined();
    dispose();
  });

  it('cancels the active flash when navigation changes targets', async () => {
    vi.useFakeTimers();
    const { controller, dispose } = createController({
      messageKeys: ['message-1', 'message-2'],
      withNavigation: true,
      didInitialScroll: true,
    });

    controller.goToMessage('message-1');
    await Promise.resolve();
    controller.completePendingScroll('message-1');
    expect(vi.getTimerCount()).toBe(1);

    controller.goToMessage('message-2');
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(TARGETED_MESSAGE_FLASH_MS);

    expect(controller.activeTargetMessageId()).toBe('message-2');
    dispose();
  });

  it('cancels the active flash on cleanup', async () => {
    vi.useFakeTimers();
    const { controller, dispose } = createController({
      messageKeys: ['message-1'],
      withNavigation: true,
      didInitialScroll: true,
    });

    controller.goToMessage('message-1');
    await Promise.resolve();
    controller.completePendingScroll('message-1');
    expect(vi.getTimerCount()).toBe(1);

    dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(TARGETED_MESSAGE_FLASH_MS);

    expect(controller.activeTargetMessageId()).toBe('message-1');
  });

  it('translates message key growth into target-loaded', async () => {
    vi.useFakeTimers();
    const { controller, dispose, setMessageKeys } = createController({
      initialTargetMessageId: 'message-1',
      withNavigation: true,
      didInitialScroll: true,
    });
    await Promise.resolve();

    setMessageKeys(['message-1']);
    await Promise.resolve();
    controller.completePendingScroll('message-1');

    expect(controller.pendingScrollTargetId()).toBeUndefined();
    expect(vi.getTimerCount()).toBe(1);
    dispose();
  });

  it('translates initial-scroll readiness into viewport-ready', async () => {
    const { controller, dispose, setDidInitialScroll } = createController({
      initialTargetMessageId: 'message-1',
      initialTargetMessageReplyId: 'reply-1',
      messageKeys: ['message-1'],
      withNavigation: true,
    });
    await Promise.resolve();

    expect(controller.pendingScrollTargetId()).toBe('message-1');
    expect(controller.pendingTargetReplyId()).toBe('reply-1');

    setDidInitialScroll(true);
    await Promise.resolve();

    expect(controller.pendingScrollTargetId()).toBeUndefined();
    expect(controller.pendingTargetReplyId()).toBe('reply-1');
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
