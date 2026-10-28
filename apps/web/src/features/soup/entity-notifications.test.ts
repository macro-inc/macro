import type { EntityData } from '@entity';
import type { NotificationSource } from '@notifications/notification-source';
import type { UnifiedNotification } from '@notifications/types';
import { createRoot } from 'solid-js';
import { createStore } from 'solid-js/store';
import { describe, expect, it } from 'vitest';
import { withEntityNotifications } from './entity-notifications';

type TestEntity = EntityData & { notifications?: UnifiedNotification[] };

const entity = (id: string, notificationIds: string[] = []): TestEntity =>
  ({
    id,
    type: 'document',
    notifications: notificationIds.map((nid) => ({ id: nid })),
  }) as TestEntity;

const source = {} as NotificationSource;
const ids = (notifications: UnifiedNotification[] | undefined) =>
  notifications?.map(({ id }) => id);

describe('withEntityNotifications', () => {
  it('reuses the accessor for the same entity, source and scope', () => {
    const task = entity('a', ['n1']);
    const first = withEntityNotifications(task, source);
    const second = withEntityNotifications(task, source);

    expect(second).not.toBe(first);
    expect(second.notifications).toBe(first.notifications);
    expect(ids(first.notifications?.())).toEqual(['n1']);
  });

  it('keeps separate accessors per source and per scope', () => {
    const task = entity('a');
    const plain = withEntityNotifications(task, source).notifications;

    expect(
      withEntityNotifications(task, {} as NotificationSource).notifications
    ).not.toBe(plain);
    expect(
      withEntityNotifications(task, source, { scopeChannelThreads: true })
        .notifications
    ).not.toBe(plain);
  });

  it('reads the current notifications of a store entity', () => {
    createRoot((dispose) => {
      const [store, setStore] = createStore({ tasks: [entity('a', ['n1'])] });
      const accessor = withEntityNotifications(
        store.tasks[0]!,
        source
      ).notifications;

      setStore('tasks', 0, 'notifications', [
        { id: 'n1' },
        { id: 'n2' },
      ] as UnifiedNotification[]);
      expect(ids(accessor?.())).toEqual(['n1', 'n2']);
      expect(
        withEntityNotifications(store.tasks[0]!, source).notifications
      ).toBe(accessor);
      dispose();
    });
  });
});
