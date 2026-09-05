import { describe, expect, it } from 'vitest';
import type { ActivityEvent } from './event';
import { groupEventsByDay } from './group-events';

function event(id: string, occurredAt: string): ActivityEvent {
  return {
    id,
    actorId: 'macro|e2e@macro.local',
    entityId: 'doc-1',
    entityType: 'document',
    occurredAt,
    action: { kind: 'created' },
  };
}

describe('groupEventsByDay', () => {
  it('returns an empty list for no events', () => {
    expect(groupEventsByDay([])).toEqual([]);
  });

  it('keeps consecutive events that share a date bucket in one group', () => {
    const groups = groupEventsByDay([
      event('a', '2026-08-21T10:00:00.000Z'),
      event('b', '2026-08-21T11:00:00.000Z'),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].events.map((item) => item.id)).toEqual(['a', 'b']);
    expect(groups[0].key).toBe(groups[0].key);
  });

  it('starts a new group when the date bucket changes', () => {
    const groups = groupEventsByDay([
      event('today', '2026-08-21T10:00:00.000Z'),
      event('older', '2020-01-01T10:00:00.000Z'),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].events.map((item) => item.id)).toEqual(['today']);
    expect(groups[1].events.map((item) => item.id)).toEqual(['older']);
    expect(groups[0].key).not.toBe(groups[1].key);
  });
});
