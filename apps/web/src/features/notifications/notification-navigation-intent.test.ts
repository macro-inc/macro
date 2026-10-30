import { afterEach, expect, it, vi } from 'vitest';
import {
  finishNotificationNavigation,
  notificationIntentFromPayload,
  notificationLaunchPath,
  pendingNotificationNavigation,
  receiveNotificationTap,
  setPendingNotificationNavigationId,
} from './notification-navigation-intent';
import { endNotificationOpen } from './notification-open-trace';

const navigation = {
  type: 'channel',
  channelId: '11111111-1111-4111-8111-111111111111',
  messageId: '22222222-2222-4222-8222-222222222222',
  threadId: null,
};
const payload = {
  notificationId: 'notification-1',
  recipientId: 'macro|test@example.com',
  navigation,
};

afterEach(() => {
  setPendingNotificationNavigationId(undefined);
  endNotificationOpen('test_complete');
});

it('decodes nested APNs routing metadata and retains known top-level identity', () => {
  expect(
    notificationIntentFromPayload({
      ...payload,
      navigation: JSON.stringify(navigation),
    })?.target
  ).toEqual(navigation);
  receiveNotificationTap({ type: 'BACKGROUND_TAP', payload }, vi.fn());
  expect(notificationLaunchPath(payload.recipientId)).toBe(
    '/channel/11111111-1111-4111-8111-111111111111?channel_message_id=22222222-2222-4222-8222-222222222222&channel_thread_id=22222222-2222-4222-8222-222222222222'
  );
  expect(notificationLaunchPath('macro|another@example.com')).toBeUndefined();
});

it.each([
  { notificationId: 'old-notification' },
  { ...payload, recipientId: undefined },
  { ...payload, navigation: '{broken' },
  {
    ...payload,
    navigation: {
      type: 'channel',
      channelId: navigation.channelId,
      messageId: navigation.messageId,
    },
  },
  { ...payload, navigation: { ...navigation, channelId: '../../login' } },
])(
  'retains the authenticated lookup for legacy or malformed routing: %j',
  (value) => {
    expect(notificationIntentFromPayload(value)?.notificationId).toBe(
      value.notificationId
    );
    expect(notificationIntentFromPayload(value)?.target).toBeUndefined();
  }
);

it('never navigates for delivery without an explicit tap', () => {
  expect(
    receiveNotificationTap({ type: 'FOREGROUND_DELIVERY', payload }, vi.fn())
  ).toBe(false);
  expect(pendingNotificationNavigation()).toBeUndefined();
});

it('keeps a tap durable until navigation acknowledgment and ignores duplicate delivery', async () => {
  let acknowledge!: () => void;
  const ack = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        acknowledge = resolve;
      })
  );
  const event = { type: 'BACKGROUND_TAP', payload, deliveryId: 'delivery-1' };
  receiveNotificationTap(event, ack);
  const intent = pendingNotificationNavigation()!;
  receiveNotificationTap(event, ack);
  expect(pendingNotificationNavigation()).toBe(intent);
  expect(ack).not.toHaveBeenCalled();
  finishNotificationNavigation(intent);
  expect(ack).toHaveBeenCalledWith('delivery-1');
  expect(pendingNotificationNavigation()).toBe(intent);
  acknowledge();
  await Promise.resolve();
  expect(pendingNotificationNavigation()).toBeUndefined();
  expect(receiveNotificationTap(event, ack)).toBe(false);
});

it('a late acknowledgment or startup snapshot cannot replace a newer tap', async () => {
  let acknowledge!: () => void;
  const firstAck = () =>
    new Promise<void>((resolve) => {
      acknowledge = resolve;
    });
  const first = {
    type: 'BACKGROUND_TAP',
    payload,
    deliveryId: 'old',
    receivedAtMs: 10,
  };
  const second = {
    ...first,
    payload: { ...payload, notificationId: 'notification-2' },
    deliveryId: 'new',
    receivedAtMs: 20,
  };
  receiveNotificationTap(first, firstAck);
  finishNotificationNavigation(pendingNotificationNavigation()!);
  receiveNotificationTap(second, vi.fn());
  receiveNotificationTap(first, firstAck);
  acknowledge();
  await Promise.resolve();
  expect(pendingNotificationNavigation()?.notificationId).toBe(
    'notification-2'
  );
});

it('a late acknowledgment cannot reopen the newer completed delivery', async () => {
  let acknowledgeFirst!: () => void;
  const firstAck = () =>
    new Promise<void>((resolve) => {
      acknowledgeFirst = resolve;
    });
  const first = {
    type: 'BACKGROUND_TAP',
    payload,
    deliveryId: 'old',
    receivedAtMs: 10,
  };
  const second = {
    ...first,
    payload: { ...payload, notificationId: 'notification-2' },
    deliveryId: 'new',
    receivedAtMs: 20,
  };
  receiveNotificationTap(first, firstAck);
  finishNotificationNavigation(pendingNotificationNavigation()!);
  receiveNotificationTap(second, async () => {});
  finishNotificationNavigation(pendingNotificationNavigation()!);
  await Promise.resolve();
  expect(pendingNotificationNavigation()).toBeUndefined();
  acknowledgeFirst();
  await Promise.resolve();
  expect(receiveNotificationTap(second, vi.fn())).toBe(false);
  expect(pendingNotificationNavigation()).toBeUndefined();
});

it('retries a failed receipt acknowledgment without navigating again', async () => {
  const ack = vi
    .fn<() => Promise<void>>()
    .mockRejectedValueOnce(new Error('bridge unavailable'))
    .mockResolvedValueOnce();
  const event = { type: 'BACKGROUND_TAP', payload, deliveryId: 'retry' };
  receiveNotificationTap(event, ack);
  const intent = pendingNotificationNavigation()!;
  finishNotificationNavigation(intent);
  await Promise.resolve();
  expect(pendingNotificationNavigation()).toBe(intent);
  receiveNotificationTap(event, ack);
  expect(pendingNotificationNavigation()).toBe(intent);
  await Promise.resolve();
  expect(ack).toHaveBeenCalledTimes(2);
  expect(pendingNotificationNavigation()).toBeUndefined();
});
