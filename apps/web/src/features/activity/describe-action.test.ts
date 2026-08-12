import { describe, expect, it } from 'vitest';
import { describeAction } from './describe-action';

describe('describeAction', () => {
  it('describes every known action with a verb phrase', () => {
    expect(describeAction({ __typename: 'GraphqlActivityCreated' })).toBe(
      'created this'
    );
    expect(describeAction({ __typename: 'GraphqlActivityEdited' })).toBe(
      'made an edit'
    );
    expect(describeAction({ __typename: 'GraphqlActivityOpened' })).toBe(
      'opened this'
    );
    expect(describeAction({ __typename: 'GraphqlActivityDeleted' })).toBe(
      'deleted this'
    );
    expect(describeAction({ __typename: 'GraphqlActivityMessaged' })).toBe(
      'sent a message'
    );
    expect(describeAction({ __typename: 'GraphqlActivitySent' })).toBe(
      'sent an email'
    );
    expect(
      describeAction({
        __typename: 'GraphqlActivityPropertyChanged',
        property: 'prop-1',
        from: null,
        to: 'Done',
      })
    ).toBe('changed a property');
    expect(
      describeAction({
        __typename: 'GraphqlActivityParticipantAdded',
        participant: 'macro|sarah@example.com',
      })
    ).toBe('added a participant');
    expect(
      describeAction({
        __typename: 'GraphqlActivityParticipantRemoved',
        participant: 'macro|sarah@example.com',
      })
    ).toBe('removed a participant');
    expect(
      describeAction({
        __typename: 'GraphqlActivityCallStarted',
        callId: 'call-1',
      })
    ).toBe('started a call');
  });

  it('humanizes the raw tag of an unknown action instead of hiding it', () => {
    expect(
      describeAction({
        __typename: 'GraphqlActivityUnknownAction',
        tag: 'transmogrified_thoroughly',
        payload: null,
      })
    ).toBe('transmogrified thoroughly');
  });
});
