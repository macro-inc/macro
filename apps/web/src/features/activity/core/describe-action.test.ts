import { describe, expect, it } from 'vitest';
import {
  describeAction,
  describeActionForEntity,
  describeRun,
} from './describe-action';
import type { ActivityAction, ActivityEvent } from './event';

const DESCRIBE_CASES: Array<[ActivityAction, string]> = [
  [{ kind: 'created' }, 'created this'],
  [{ kind: 'edited' }, 'made an edit'],
  [{ kind: 'opened' }, 'opened this'],
  [{ kind: 'deleted' }, 'deleted this'],
  [{ kind: 'messaged' }, 'sent a message'],
  [{ kind: 'email-sent' }, 'sent an email'],
  [
    { kind: 'property-changed', property: 'prop-1', from: null, to: 'Done' },
    'changed a property',
  ],
  [
    { kind: 'participant-added', participant: 'macro|sarah@example.com' },
    'added a participant',
  ],
  [
    { kind: 'participant-removed', participant: 'macro|sarah@example.com' },
    'removed a participant',
  ],
  [{ kind: 'call-started' }, 'started a call'],
];

const ENTITY_CASES: Array<
  [ActivityAction, { verb: string; connector?: string }]
> = [
  [{ kind: 'created' }, { verb: 'created' }],
  [{ kind: 'messaged' }, { verb: 'sent a message', connector: 'in' }],
  [
    { kind: 'participant-added', participant: 'macro|sarah@example.com' },
    { verb: 'added a participant', connector: 'to' },
  ],
  [
    { kind: 'property-changed', property: 'prop-1', from: null, to: 'Done' },
    { verb: 'changed a property', connector: 'on' },
  ],
];

describe('describeAction', () => {
  it.each(DESCRIBE_CASES)('describes %j', (action, expected) => {
    expect(describeAction(action)).toBe(expected);
  });

  it.each(ENTITY_CASES)(
    'pairs %j with its entity connector',
    (action, expected) => {
      expect(describeActionForEntity(action)).toEqual(expected);
    }
  );

  it('humanizes the raw tag of an unknown action instead of hiding it', () => {
    expect(
      describeAction({
        kind: 'unknown',
        tag: 'transmogrified_thoroughly',
      })
    ).toBe('transmogrified thoroughly');
  });
});

describe('describeRun', () => {
  const event = (id: string, action: ActivityAction): ActivityEvent => ({
    id,
    actorId: 'macro|sarah@example.com',
    entityId: 'doc-1',
    entityType: 'document',
    occurredAt: '2026-08-21T12:00:00.000Z',
    action,
  });

  it('carries no count for a single', () => {
    expect(
      describeRun({ kind: 'single', event: event('a', { kind: 'edited' }) })
    ).toEqual({ action: { kind: 'edited' }, countLabel: undefined });
  });

  it('counts a run in times', () => {
    const events = ['a', 'b', 'c', 'd', 'e'].map((id) =>
      event(id, { kind: 'edited' })
    );
    expect(
      describeRun({
        kind: 'run',
        events,
        first: events[0],
        last: events[events.length - 1],
      })
    ).toEqual({ action: { kind: 'edited' }, countLabel: '5 times' });
  });

  it('counts a property run in changes and reads the net change', () => {
    const newest = event('b', {
      kind: 'property-changed',
      property: 'status',
      from: 'B',
      to: 'C',
    });
    const oldest = event('a', {
      kind: 'property-changed',
      property: 'status',
      from: 'A',
      to: 'B',
    });
    expect(
      describeRun({
        kind: 'run',
        events: [newest, oldest],
        first: newest,
        last: oldest,
      })
    ).toEqual({
      action: {
        kind: 'property-changed',
        property: 'status',
        from: 'A',
        to: 'C',
      },
      countLabel: '2 changes',
    });
  });
});
