import type { TaskEntityWithProperties } from '@entity/types/entity';
import { isWithNotification } from '@entity/types/notification';
import { unreadFilterFn } from '@entity/utils/filter';
import type { NotificationSource } from '@notifications/notification-source';
import { describe, expect, it, vi } from 'vitest';
import { prepareTaskEntities } from './prepare-task-entities';

vi.mock('../filters/task-predicates', () => ({ taskMatchesView: () => true }));

const task: TaskEntityWithProperties = {
  id: 'task-1',
  type: 'document',
  fileType: 'md',
  subType: { type: 'task' },
  name: 'Example task',
  ownerId: 'user-1',
  createdAt: '2026-09-07T12:00:00Z',
  updatedAt: '2026-09-07T12:00:00Z',
};
const context = { tab: 'team-tasks' as const, userId: 'user-1', facets: {} };
const source = { notificationsByEntity: () => ({}) } as NotificationSource;

describe('Tasks notification rows', () => {
  it('renders unread state for a GraphQL task with an empty notification array', () => {
    const rawTask = { ...task, notifications: [] };
    const [row] = prepareTaskEntities([rawTask], context, source);
    expect(() => unreadFilterFn(row)).not.toThrow();
    expect(isWithNotification(row)).toBe(true);
    expect(unreadFilterFn(row)).toBe(false);
  });

  it('preserves existing notification accessors and task properties', () => {
    const notifications = () => [];
    const rawTask = { ...task, notifications };
    const [row] = prepareTaskEntities([rawTask], context, source);
    expect(isWithNotification(row)).toBe(true);
    if (isWithNotification(row)) expect(row.notifications?.()).toEqual([]);
    expect(row.id).toBe(task.id);
  });
});
