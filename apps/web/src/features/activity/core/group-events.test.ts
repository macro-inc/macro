import { describe, expect, it } from 'vitest';
import { entryHead } from './collapse-runs';
import type { ActivityEvent } from './event';
import { groupEventsByDay } from './group-events';

function event(
  id: string,
  occurredAt: string,
  overrides: Partial<ActivityEvent> = {}
): ActivityEvent {
  return {
    id,
    actorId: 'macro|e2e@macro.local',
    entityId: 'doc-1',
    entityType: 'document',
    occurredAt,
    action: { kind: 'created' },
    ...overrides,
  };
}

const ids = (entries: ReturnType<typeof groupEventsByDay>[number]['entries']) =>
  entries.map((entry) => entryHead(entry).id);

describe('groupEventsByDay', () => {
  it('returns an empty list for no events', () => {
    expect(groupEventsByDay([])).toEqual([]);
  });

  it('keeps consecutive events that share a date bucket in one group', () => {
    const groups = groupEventsByDay([
      event('a', '2026-08-21T10:00:00.000Z', { action: { kind: 'edited' } }),
      event('b', '2026-08-21T11:00:00.000Z'),
    ]);

    expect(groups).toHaveLength(1);
    expect(ids(groups[0].entries)).toEqual(['a', 'b']);
  });

  it('starts a new group when the date bucket changes', () => {
    const groups = groupEventsByDay([
      event('today', '2026-08-21T10:00:00.000Z'),
      event('older', '2020-01-01T10:00:00.000Z'),
    ]);

    expect(groups).toHaveLength(2);
    expect(ids(groups[0].entries)).toEqual(['today']);
    expect(ids(groups[1].entries)).toEqual(['older']);
    expect(groups[0].key).not.toBe(groups[1].key);
  });

  it('collapses same-entity runs inside a day but never across a day header', () => {
    const groups = groupEventsByDay([
      event('a', '2026-08-21T12:00:00.000Z', { action: { kind: 'edited' } }),
      event('b', '2026-08-21T11:00:00.000Z', { action: { kind: 'edited' } }),
      event('c', '2020-01-01T10:00:00.000Z', { action: { kind: 'edited' } }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0].entries).toHaveLength(1);
    expect(groups[0].entries[0].kind).toBe('run');
    expect(groups[1].entries).toEqual([
      { kind: 'single', event: expect.objectContaining({ id: 'c' }) },
    ]);
  });
});
