import type { UnifiedNotification } from '@notifications/types';
import { batch, createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type AlertNotificationSource,
  createReminderAlertFeed,
} from './create-reminder-alert-feed';

const notification: UnifiedNotification = {
  id: 'delivery-1',
  entity_id: 'reminder-1',
  entity_type: 'reminder',
  created_at: '2026-09-21T10:00:00Z',
  updated_at: '2026-09-21T10:00:00Z',
  state: 'unseen',
  sent: true,
  notification_event_type: 'reminder',
  notification_metadata: {
    tag: 'reminder',
    content: {
      reminderId: 'reminder-1',
      description: 'Follow up',
      scheduledFor: '2026-09-21T10:00:00Z',
    },
  },
};

function mount() {
  return createRoot((dispose) => {
    const [notifications, setNotifications] = createSignal<
      UnifiedNotification[]
    >([]);
    const [isLoading, setLoading] = createSignal(true);
    const [isStarted, setStarted] = createSignal(true);
    const [mutedEntities, setMutedEntities] = createSignal<
      ReturnType<AlertNotificationSource['mutedEntities']>
    >([]);
    const readLoading = vi.fn(isLoading);
    const readNotifications = vi.fn(notifications);
    const [done, setDone] = createSignal(false);
    const [account, setAccount] = createSignal<string | undefined>('alice');
    let deliver!: (n: UnifiedNotification) => void;
    const unsubscribe = vi.fn();
    const alerts = createReminderAlertFeed(
      {
        notifications: readNotifications,
        isLoading: readLoading,
        isStarted,
        mutedEntities,
        subscribe: (callback) => {
          deliver = callback;
          return unsubscribe;
        },
        withLocalOverrides: (item) => ({
          ...item,
          state: done() ? 'done' : item.state,
        }),
      },
      account
    );
    return {
      alerts,
      setNotifications,
      setLoading,
      setStarted,
      setMutedEntities,
      readLoading,
      readNotifications,
      setDone,
      setAccount,
      get deliver() {
        return deliver;
      },
      unsubscribe,
      dispose,
    };
  });
}

describe('reminder alert feed', () => {
  afterEach(() => vi.useRealTimers());

  it('buffers live deliveries without activating an unused notification query', () => {
    const h = mount();
    h.setStarted(false);
    h.readLoading.mockClear();
    h.readNotifications.mockClear();
    h.setNotifications([notification]);
    h.setLoading(false);
    h.deliver(notification);
    expect(h.alerts()).toHaveLength(1);
    expect(h.readLoading).not.toHaveBeenCalled();
    expect(h.readNotifications).not.toHaveBeenCalled();
    h.setStarted(true);
    expect(h.alerts()).toHaveLength(1);
    h.setNotifications([]);
    expect(h.alerts()).toEqual([]);
    h.dispose();
  });

  it('retains a live burst while no foreground consumer reads alerts', () => {
    const h = mount();
    h.setStarted(false);
    batch(() => {
      for (let i = 0; i < 4; i++)
        h.deliver({
          ...notification,
          id: `delivery-${i}`,
          notification_metadata: {
            tag: 'reminder',
            content: {
              reminderId: `reminder-${i}`,
              description: `Follow up ${i}`,
              scheduledFor: '2026-09-21T10:00:00Z',
            },
          },
        });
    });
    expect(h.alerts()).toHaveLength(4);
    h.dispose();
  });

  it('retains loaded catch-up while transport restarts without starting its query', () => {
    const h = mount();
    h.setNotifications([notification]);
    h.setLoading(false);
    expect(h.alerts()).toHaveLength(1);
    h.setStarted(false);
    h.readLoading.mockClear();
    h.readNotifications.mockClear();
    h.setNotifications([]);
    expect(h.alerts()).toHaveLength(1);
    expect(h.readLoading).not.toHaveBeenCalled();
    expect(h.readNotifications).not.toHaveBeenCalled();
    h.setLoading(true);
    h.setStarted(true);
    expect(h.alerts()).toHaveLength(1);
    h.setDone(true);
    expect(h.alerts()).toEqual([]);
    h.setDone(false);
    expect(h.alerts()).toHaveLength(1);
    h.setLoading(false);
    expect(h.alerts()).toEqual([]);
    h.dispose();
  });

  it('deduplicates a batched occurrence and discards the batch on account change', () => {
    const h = mount();
    h.setStarted(false);
    batch(() => {
      h.deliver(notification);
      h.deliver({ ...notification, id: 'same-occurrence' });
    });
    expect(h.alerts()).toHaveLength(1);
    batch(() => {
      h.deliver({ ...notification, id: 'late-alice' });
      h.setAccount('bob');
    });
    expect(h.alerts()).toEqual([]);
    h.setAccount('alice');
    expect(h.alerts()).toEqual([]);
    h.dispose();
  });

  it('records batched synchronous subscription replay before the first consumer', () => {
    const h = createRoot((dispose) => {
      const alerts = createReminderAlertFeed(
        {
          notifications: () => [],
          isLoading: () => false,
          isStarted: () => false,
          mutedEntities: () => [],
          subscribe: (deliver) => {
            batch(() => {
              deliver(notification);
              deliver({
                ...notification,
                id: 'delivery-2',
                notification_metadata: {
                  tag: 'reminder',
                  content: {
                    reminderId: 'reminder-2',
                    description: 'Second reminder',
                    scheduledFor: '2026-09-21T10:00:00Z',
                  },
                },
              });
            });
            return () => {};
          },
        },
        () => 'alice'
      );
      return { alerts, dispose };
    });
    expect(h.alerts()).toHaveLength(2);
    h.dispose();
  });

  it('does not carry retained catch-up across accounts while a new transport is idle', () => {
    const h = mount();
    h.setNotifications([notification]);
    h.setLoading(false);
    expect(h.alerts()).toHaveLength(1);
    h.setStarted(false);
    h.setAccount('bob');
    expect(h.alerts()).toEqual([]);
    h.setAccount('alice');
    expect(h.alerts()).toEqual([]);
    h.dispose();
  });

  it('matches mute preferences to the primary notification entity', () => {
    const h = mount();
    h.deliver({ ...notification, entity_id: 'primary-reminder' });
    h.setMutedEntities([{ item_id: 'reminder-1', item_type: 'reminder' }]);
    expect(h.alerts()).toHaveLength(1);
    h.setMutedEntities([
      { item_id: 'primary-reminder', item_type: 'reminder' },
    ]);
    expect(h.alerts()).toEqual([]);
    h.dispose();
  });

  it.each(['live', 'loaded'] as const)(
    'hides a %s occurrence while snoozed and restores it at expiry',
    (delivery) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-09-29T10:00:00Z'));
      const h = mount();
      if (delivery === 'live') h.deliver(notification);
      else {
        h.setNotifications([notification]);
        h.setLoading(false);
      }
      expect(h.alerts()).toHaveLength(1);
      h.setMutedEntities([
        {
          item_id: 'reminder-1',
          item_type: 'reminder',
          snoozed_until: '2026-09-29T10:01:00Z',
        },
      ]);
      expect(h.alerts()).toEqual([]);
      vi.advanceTimersByTime(59_999);
      expect(h.alerts()).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(h.alerts()).toHaveLength(1);
      h.dispose();
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it('honors permanent mutes, expiry extensions, and explicit unmute without acknowledging', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-29T10:00:00Z'));
    const h = mount();
    h.deliver(notification);
    const item = { item_id: 'reminder-1', item_type: 'reminder' };
    h.setMutedEntities([{ ...item, snoozed_until: '2026-09-29T10:01:00Z' }]);
    vi.advanceTimersByTime(30_000);
    h.setMutedEntities([{ ...item, snoozed_until: '2026-09-29T10:02:00Z' }]);
    vi.advanceTimersByTime(30_000);
    expect(h.alerts()).toEqual([]);
    h.setMutedEntities([item]);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(120_000);
    expect(h.alerts()).toEqual([]);
    h.setMutedEntities([]);
    expect(h.alerts()).toHaveLength(1);
    h.setMutedEntities([{ ...item, item_type: 'document' }]);
    expect(h.alerts()).toHaveLength(1);
    h.dispose();
  });

  it('rejects deliveries from a disposed account subscription', () => {
    const h = mount();
    const aliceDelivery = h.deliver;
    h.setAccount('bob');
    expect(h.unsubscribe).toHaveBeenCalledOnce();
    aliceDelivery(notification);
    expect(h.alerts()).toEqual([]);
    h.deliver({ ...notification, id: 'bob-delivery' });
    expect(h.alerts()).toHaveLength(1);
    h.setAccount('alice');
    aliceDelivery(notification);
    expect(h.alerts()).toEqual([]);
    h.dispose();
  });

  it('forgets unconfirmed deliveries when the account changes', () => {
    const h = mount();
    h.deliver(notification);
    expect(h.alerts()).toHaveLength(1);
    h.setAccount(undefined);
    expect(h.alerts()).toEqual([]);
    h.setAccount('bob');
    expect(h.alerts()).toEqual([]);
    h.dispose();
  });
  it('alerts on live delivery before query hydration or outside the loaded page', () => {
    const h = mount();
    h.deliver(notification);
    expect(h.alerts()).toHaveLength(1);
    h.setLoading(false);
    expect(h.alerts()).toHaveLength(1);
    h.deliver({ ...notification });
    expect(h.alerts()).toHaveLength(1);
    h.dispose();
    expect(h.unsubscribe).toHaveBeenCalledOnce();
  });

  it('hands lifecycle to the query once confirmed, without replaying on removal', () => {
    const h = mount();
    h.deliver(notification);
    h.setNotifications([notification]);
    h.setLoading(false);
    expect(h.alerts()).toHaveLength(1);
    h.setNotifications([]);
    expect(h.alerts()).toEqual([]);
    h.dispose();
  });

  it('respects local done state even for a live item outside the query page', () => {
    const h = mount();
    h.deliver(notification);
    h.setDone(true);
    expect(h.alerts()).toEqual([]);
    h.dispose();
  });

  it.each(['seen', 'done'] as const)(
    'restores the alert when a loaded optimistic %s state rolls back',
    (state) => {
      const h = mount();
      const [currentState, setCurrentState] = createSignal(notification.state);
      h.setLoading(false);
      h.setNotifications([
        {
          ...notification,
          get state() {
            return currentState();
          },
        },
      ]);
      expect(h.alerts()).toHaveLength(1);
      setCurrentState(state);
      expect(h.alerts()).toEqual([]);
      setCurrentState('unseen');
      expect(h.alerts()).toHaveLength(1);
      h.dispose();
    }
  );

  it.each([false, true])(
    'keeps an acknowledged occurrence hidden across mixed duplicate rows (reversed: %s)',
    (reversed) => {
      const h = mount();
      const seen: UnifiedNotification = {
        ...notification,
        id: 'seen-delivery',
        state: 'seen',
      };
      h.setLoading(false);
      h.setNotifications(
        reversed ? [seen, notification] : [notification, seen]
      );
      expect(h.alerts()).toEqual([]);
      h.setNotifications([notification]);
      expect(h.alerts()).toEqual([]);
      h.setNotifications([notification, { ...seen, state: 'unseen' }]);
      expect(h.alerts()).toHaveLength(1);
      h.dispose();
    }
  );

  it.each(['seen', 'done'] as const)(
    'forgets replayed delivery ids after a %s query occurrence leaves the feed',
    (state) => {
      const h = mount();
      h.deliver(notification);
      h.setLoading(false);
      h.setNotifications([
        {
          ...notification,
          id: 'query-delivery',
          state,
          notification_metadata: {
            tag: 'reminder',
            content: {
              reminderId: 'reminder-1',
              description: 'Follow up',
              scheduledFor: '2026-09-21T12:00:00+02:00',
            },
          },
        },
      ]);
      expect(h.alerts()).toEqual([]);
      h.setNotifications([]);
      expect(h.alerts()).toEqual([]);
      h.deliver({ ...notification, id: 'late-replay' });
      expect(h.alerts()).toEqual([]);
      h.deliver({
        ...notification,
        id: 'next-occurrence',
        notification_metadata: {
          tag: 'reminder',
          content: {
            reminderId: 'reminder-1',
            description: 'Follow up',
            scheduledFor: '2026-09-22T10:00:00Z',
          },
        },
      });
      expect(h.alerts()).toHaveLength(1);
      expect(h.alerts()[0].scheduledFor).toBe('2026-09-22T10:00:00.000Z');
      h.setAccount('bob');
      h.deliver(notification);
      expect(h.alerts()).toHaveLength(1);
      expect(h.alerts()[0].scheduledFor).toBe('2026-09-21T10:00:00.000Z');
      h.dispose();
    }
  );
});
