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
  TARGETED_MESSAGE_FLASH_MS,
} from '../create-target-message-controller';
import type { ThreadListNavigation } from '../ThreadList';

afterEach(() => {
  queryClient.clear();
  vi.useRealTimers();
});

const CHANNEL = 'ch1';
const NAVIGATION = {} as ThreadListNavigation;

function mount(init?: { targetMessageId?: string; targetReplyId?: string }) {
  return createRoot((dispose) => {
    const [keys, setKeys] = createSignal<string[]>([]);
    const [navigation, setNavigation] = createSignal<ThreadListNavigation>();
    const [didInitialScroll, setDidInitialScroll] = createSignal(false);

    const controller = createTargetMessageController({
      channelId: () => CHANNEL,
      initialTargetMessageId: init?.targetMessageId,
      initialTargetMessageReplyId: init?.targetReplyId,
      messageKeys: keys,
      navigation,
      didInitialScroll,
    });

    const ready = (loaded: string[]) => {
      setKeys(loaded);
      setNavigation(NAVIGATION);
      setDidInitialScroll(true);
    };

    return { controller, ready, setKeys, dispose };
  });
}

describe('construction', () => {
  it('does not read ThreadList inputs during construct (Channel.tsx TDZ)', () => {
    createRoot((dispose) => {
      const boom = (): never => {
        throw new Error('read during construct');
      };
      expect(() =>
        createTargetMessageController({
          channelId: () => CHANNEL,
          initialTargetMessageId: 'm1',
          initialTargetMessageReplyId: 'r1',
          messageKeys: boom,
          navigation: boom,
          didInitialScroll: boom,
        })
      ).not.toThrow();
      dispose();
    });
  });
});

describe('flash timer', () => {
  it('releases the target after TARGETED_MESSAGE_FLASH_MS', () => {
    vi.useFakeTimers();
    const { controller, ready, dispose } = mount();
    ready(['m1']);
    controller.goToMessage('m1');
    controller.completePendingScroll('m1');
    expect(controller.activeTargetMessageId()).toBe('m1');

    vi.advanceTimersByTime(TARGETED_MESSAGE_FLASH_MS - 1);
    expect(controller.activeTargetMessageId()).toBe('m1');
    vi.advanceTimersByTime(1);
    expect(controller.activeTargetMessageId()).toBeUndefined();
    dispose();
  });

  it('a navigate mid-flash disposes the timer; the new target flashes on its own clock', () => {
    vi.useFakeTimers();
    const { controller, ready, dispose } = mount();
    ready(['m1', 'm2']);
    controller.goToMessage('m1');
    controller.completePendingScroll('m1');
    vi.advanceTimersByTime(TARGETED_MESSAGE_FLASH_MS / 2);

    controller.goToMessage('m2');
    controller.completePendingScroll('m2');
    vi.advanceTimersByTime(TARGETED_MESSAGE_FLASH_MS / 2 + 1);
    expect(controller.activeTargetMessageId()).toBe('m2');

    vi.advanceTimersByTime(TARGETED_MESSAGE_FLASH_MS / 2);
    expect(controller.activeTargetMessageId()).toBeUndefined();
    dispose();
  });

  it('unmount cancels a running flash', () => {
    vi.useFakeTimers();
    const { controller, ready, dispose } = mount();
    ready(['m1']);
    controller.goToMessage('m1');
    controller.completePendingScroll('m1');
    dispose();
    expect(() =>
      vi.advanceTimersByTime(TARGETED_MESSAGE_FLASH_MS)
    ).not.toThrow();
    controller.reset();
    expect(controller.activeTargetMessageId()).toBe('m1');
  });
});

describe('readiness', () => {
  it('clears a nested target root row only once the ThreadList is ready', () => {
    const { controller, ready, dispose } = mount({
      targetMessageId: 'm1',
      targetReplyId: 'r1',
    });
    expect(controller.pendingScrollTargetId()).toBe('m1');
    expect(controller.pendingTargetReplyId()).toBe('r1');
    expect(controller.hasPendingElementScroll()).toBe(true);

    ready(['m1']);
    expect(controller.pendingScrollTargetId()).toBeUndefined();
    expect(controller.pendingTargetReplyId()).toBe('r1');
    expect(controller.hasPendingElementScroll()).toBe(true);
    dispose();
  });

  it('waits for the target to be in the loaded window', () => {
    const { controller, ready, setKeys, dispose } = mount({
      targetMessageId: 'm1',
      targetReplyId: 'r1',
    });
    ready(['m0']);
    expect(controller.pendingScrollTargetId()).toBe('m1');
    setKeys(['m0', 'm1']);
    expect(controller.pendingScrollTargetId()).toBeUndefined();
    dispose();
  });

  it('never clears a root-only target on readiness; only its ack does', () => {
    const { controller, ready, dispose } = mount({ targetMessageId: 'm1' });
    ready(['m1']);
    expect(controller.pendingScrollTargetId()).toBe('m1');
    controller.completePendingScroll('m1');
    expect(controller.pendingScrollTargetId()).toBeUndefined();
    expect(controller.hasPendingElementScroll()).toBe(false);
    dispose();
  });
});

describe('pagination restore', () => {
  const aroundData: ChannelMessagesData = {
    pageParams: [null],
    pages: [{ items: [], next_cursor: 'next', previous_cursor: 'prev' }],
  };

  it('promotes the around-query to the default query on the scroll ack and clears the anchor', () => {
    queryClient.setQueryData(
      getChannelMessagesQueryKey(CHANNEL, 'm1'),
      aroundData
    );
    const { controller, ready, dispose } = mount({ targetMessageId: 'm1' });
    ready(['m1']);
    expect(controller.loadAroundMessageId()).toBe('m1');

    controller.completePendingScroll('m1');
    expect(
      queryClient.getQueryData(getChannelMessagesQueryKey(CHANNEL, null))
    ).toEqual(aroundData);
    expect(
      queryClient.getQueryData(getChannelMessagesQueryKey(CHANNEL, 'm1'))
    ).toBeUndefined();
    expect(controller.loadAroundMessageId()).toBeUndefined();
    dispose();
  });

  it('keeps the anchor when there is nothing to restore', () => {
    const { controller, ready, dispose } = mount({ targetMessageId: 'm1' });
    ready(['m1']);
    controller.completePendingScroll('m1');
    expect(controller.loadAroundMessageId()).toBe('m1');
    dispose();
  });
});
