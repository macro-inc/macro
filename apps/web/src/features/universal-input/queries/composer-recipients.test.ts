import { describe, expect, it } from 'vitest';
import { composerRecipients, recipientAddresses } from './composer-recipients';

const people = [
  {
    id: 'macro|julia@example.com',
    label: 'Julia Park',
    email: 'julia@example.com',
    kind: 'user' as const,
  },
  {
    id: 'macro|other@example.com',
    label: 'Julia Adams',
    email: 'other@example.com',
    kind: 'user' as const,
  },
];
describe('composer recipient adapters', () => {
  it('keeps ambiguous names visible and invalid until the user chooses an address', () => {
    const selected = composerRecipients('Julia', people);
    expect(selected).toEqual([
      {
        kind: 'custom',
        id: 'Julia',
        data: { id: 'Julia', email: 'Julia', invalid: true },
      },
    ]);
    expect(recipientAddresses(selected)).toBe('Julia');
  });
  it('preserves known recipients and external addresses across chip edits', () => {
    const selected = composerRecipients(
      'Julia Park, external@example.org',
      people
    );
    expect(selected.map((person) => person.data.email)).toEqual([
      'julia@example.com',
      'external@example.org',
    ]);
    expect(selected[1]).toMatchObject({
      kind: 'custom',
      data: { invalid: false },
    });
    expect(recipientAddresses(selected.slice(1))).toBe('external@example.org');
  });
});
