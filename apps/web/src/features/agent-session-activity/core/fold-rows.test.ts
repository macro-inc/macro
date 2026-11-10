import { describe, expect, it } from 'vitest';
import type { AgentActivityRow } from '../context/agent-activity-source';
import { foldAgentActivityRows } from './fold-rows';

describe('foldAgentActivityRows', () => {
  it('keeps latest entities first and collapses only consecutive verbs per entity', () => {
    const rows: AgentActivityRow[] = [
      {
        id: '5',
        entityType: 'document',
        entityId: 'a',
        action: 'edited',
        verb: 'edited',
        occurredAt: '2026-01-01T00:05:00Z',
      },
      {
        id: '4',
        entityType: 'project',
        entityId: 'b',
        action: 'created',
        verb: 'created',
        occurredAt: '2026-01-01T00:04:00Z',
      },
      {
        id: '3',
        entityType: 'document',
        entityId: 'a',
        action: 'edited',
        verb: 'edited',
        occurredAt: '2026-01-01T00:03:00Z',
      },
      {
        id: '2',
        entityType: 'document',
        entityId: 'a',
        action: 'created',
        verb: 'created',
        occurredAt: '2026-01-01T00:02:00Z',
      },
      {
        id: '1',
        entityType: 'document',
        entityId: 'a',
        action: 'edited',
        verb: null,
        occurredAt: '2026-01-01T00:01:00Z',
      },
    ];

    const items = foldAgentActivityRows(rows);
    expect(items.map((item) => item.entityId)).toEqual(['a', 'b']);
    expect(items[0]?.steps.map((step) => [step.verb, step.count])).toEqual([
      ['edited', 2],
      ['created', 1],
      ['edited', 1],
    ]);
    expect(items[0]?.latest.id).toBe('5');
    expect(items[1]?.steps[0]?.latest.id).toBe('4');
  });
});
