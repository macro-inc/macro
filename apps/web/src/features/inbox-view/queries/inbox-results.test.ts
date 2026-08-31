import type { EntityData, Notification, WithNotification } from '@entity';
import { describe, expect, it } from 'vitest';
import { groupInboxEntitiesByDate } from './inbox-results';

const entity = (id: string, updatedAt: string): WithNotification<EntityData> =>
  ({
    id,
    name: id,
    type: 'document',
    updatedAt,
    notifications: () => [] as Notification[],
  }) as WithNotification<EntityData>;

describe('groupInboxEntitiesByDate', () => {
  it('groups the loaded entities by their effective sort timestamp', () => {
    const groups = groupInboxEntitiesByDate(
      [
        entity('today-1', '2025-01-15T12:00:00Z'),
        entity('today-2', '2025-01-15T08:00:00Z'),
        entity('yesterday', '2025-01-14T12:00:00Z'),
        entity('week', '2025-01-10T12:00:00Z'),
      ],
      new Date('2025-01-15T18:00:00Z')
    );

    expect(groups.map((group) => group.label)).toEqual([
      'Today',
      'Yesterday',
      'Last 7 days',
    ]);
    expect(groups[0].entities.map((item) => item.id)).toEqual([
      'today-1',
      'today-2',
    ]);
    expect(groups.map((group) => group.count)).toEqual([2, 1, 1]);
  });

  it('uses sortTs before the entity timestamps', () => {
    const item = {
      ...entity('sorted', '2024-01-01T00:00:00Z'),
      sortTs: '2025-01-15T12:00:00Z',
    };

    expect(
      groupInboxEntitiesByDate([item], new Date('2025-01-15T18:00:00Z'))[0]
        .label
    ).toBe('Today');
  });
});
