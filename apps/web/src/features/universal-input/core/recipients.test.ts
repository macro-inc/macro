import { describe, expect, it } from 'vitest';
import { type Recipient, resolveRecipientTerms } from './recipients';

describe('message channel recipients', () => {
  it('resolves an extracted channel name to the available channel', () => {
    const channel: Recipient = {
      id: 'bug-reports-channel',
      label: 'Bug Reports',
      kind: 'channel',
    };
    const result = resolveRecipientTerms(
      ['bug reports'],
      [
        channel,
        { id: 'engineering-channel', label: 'Engineering', kind: 'channel' },
      ],
      false
    );

    expect(result).toEqual({ recipients: [channel], unresolved: [] });
  });

  it('leaves the channel unresolved when it is unavailable to the user', () => {
    const result = resolveRecipientTerms(
      ['bug reports'],
      [{ id: 'engineering-channel', label: 'Engineering', kind: 'channel' }],
      false
    );

    expect(result).toEqual({ recipients: [], unresolved: ['bug reports'] });
  });
});
