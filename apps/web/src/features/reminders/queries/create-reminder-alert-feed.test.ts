import type { UnifiedNotification } from '@notifications/types';
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createReminderAlertFeed } from './create-reminder-alert-feed';

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
    const [done, setDone] = createSignal(false);
    const [account, setAccount] = createSignal<string | undefined>('alice');
    let deliver!: (n: UnifiedNotification) => void;
    const unsubscribe = vi.fn();
    const alerts = createReminderAlertFeed(
      {
        notifications,
        isLoading,
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
