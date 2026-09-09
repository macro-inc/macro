import { describe, expect, it } from 'vitest';
import {
  collapseRuns,
  entryAction,
  entryHead,
  entryKey,
  entrySize,
} from './collapse-runs';
import type { ActivityAction, ActivityEvent } from './event';

let clock = 0;

function event(
  id: string,
  overrides: Partial<Omit<ActivityEvent, 'action'>> & {
    action?: ActivityAction;
  } = {}
): ActivityEvent {
  clock += 1;
  return {
    id,
    actorId: 'macro|sarah@example.com',
    entityId: 'doc-1',
    entityType: 'document',
    occurredAt: new Date(
      Date.UTC(2026, 7, 21, 12, 0, 0) - clock * 60_000
    ).toISOString(),
    action: { kind: 'edited' },
    ...overrides,
  };
}

function property(
  id: string,
  from: unknown,
  to: unknown,
  propertyId = 'status'
): ActivityEvent {
  return event(id, {
    action: { kind: 'property-changed', property: propertyId, from, to },
  });
}

describe('collapseRuns', () => {
  it('returns nothing for no events', () => {
    expect(collapseRuns([])).toEqual([]);
  });

  it('keeps a lone event as a single', () => {
    const only = event('a');
    expect(collapseRuns([only])).toEqual([{ kind: 'single', event: only }]);
  });

  it('folds consecutive same-actor same-entity same-action events into one run, newest first', () => {
    const events = [event('a'), event('b'), event('c')];
    const entries = collapseRuns(events);

    expect(entries).toHaveLength(1);
    const run = entries[0];
    if (run.kind !== 'run') throw new Error(run.kind);
    expect(run.events.map((item) => item.id)).toEqual(['a', 'b', 'c']);
    expect(run.first.id).toBe('a');
    expect(run.last.id).toBe('c');
    expect(entrySize(run)).toBe(3);
    expect(entryHead(run).id).toBe('a');
    expect(entryKey(run)).toBe('a..c');
  });

  it('breaks a run on a different actor, entity, or action kind', () => {
    const entries = collapseRuns([
      event('a'),
      event('b', { actorId: 'macro|joe@example.com' }),
      event('c', { actorId: 'macro|joe@example.com' }),
      event('d', { actorId: 'macro|joe@example.com', entityId: 'doc-2' }),
      event('e', {
        actorId: 'macro|joe@example.com',
        entityId: 'doc-2',
        action: { kind: 'opened' },
      }),
    ]);

    expect(entries.map((entry) => [entry.kind, entrySize(entry)])).toEqual([
      ['single', 1],
      ['run', 2],
      ['single', 1],
      ['single', 1],
    ]);
  });

  it('does not fold non-consecutive events on the same entity', () => {
    const entries = collapseRuns([
      event('a'),
      event('b', { entityId: 'doc-2' }),
      event('c'),
    ]);
    expect(entries.map((entry) => entryHead(entry).id)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(entries.every((entry) => entry.kind === 'single')).toBe(true);
  });

  it('folds property changes only when they touch the same property and reads the net change', () => {
    const entries = collapseRuns([
      property('c', 'In progress', 'Done'),
      property('b', 'Todo', 'In progress'),
      property('a', null, 'Todo'),
      property('p', 'Low', 'High', 'priority'),
    ]);

    expect(entries).toHaveLength(2);
    expect(entrySize(entries[0])).toBe(3);
    expect(entryAction(entries[0])).toEqual({
      kind: 'property-changed',
      property: 'status',
      from: null,
      to: 'Done',
    });
    expect(entries[1]).toEqual({
      kind: 'single',
      event: expect.objectContaining({ id: 'p' }),
    });
  });

  it('collapses 1,000 events in under 2ms', () => {
    const events = Array.from({ length: 1000 }, (_, index) =>
      event(`evt-${index}`, { entityId: `doc-${Math.floor(index / 5)}` })
    );
    expect(collapseRuns(events)).toHaveLength(200);

    // Shared CI runners inject GC pauses and scheduler hiccups into any single
    // sample, so the budget applies to the best of several runs: that still
    // fails on an algorithmic regression without failing on a noisy neighbour.
    let fastest = Number.POSITIVE_INFINITY;
    for (let sample = 0; sample < 20; sample++) {
      const started = performance.now();
      collapseRuns(events);
      fastest = Math.min(fastest, performance.now() - started);
    }

    expect(fastest).toBeLessThan(2);
  });
});
