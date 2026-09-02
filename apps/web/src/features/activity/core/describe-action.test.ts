import { describe, expect, it } from 'vitest';
import { describeAction, describeActionForEntity } from './describe-action';
import type { ActivityAction } from './event';

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
