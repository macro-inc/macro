import { describe, expect, it } from 'vitest';
import {
  PREFILL_CAP,
  prefillableTeammates,
  removeInviteSlot,
  validInviteEmails,
} from './teamInvites';

const contact = (email: string) => ({ email });

describe('prefillableTeammates', () => {
  it('picks same-domain contacts, skipping the user and duplicates', () => {
    expect(
      prefillableTeammates({
        contacts: [
          contact('ada@macro.com'),
          contact('grace@other.com'),
          contact('ada@macro.com'),
          contact('me@macro.com'),
          contact('alan@macro.com'),
        ],
        domain: 'macro.com',
        ownEmail: 'me@macro.com',
      })
    ).toEqual(['ada@macro.com', 'alan@macro.com']);
  });

  it('pre-adds nothing without a suggested domain', () => {
    expect(
      prefillableTeammates({
        contacts: [contact('ada@gmail.com')],
        domain: undefined,
        ownEmail: 'me@gmail.com',
      })
    ).toEqual([]);
  });

  it('caps how many teammates get pre-added', () => {
    const contacts = Array.from({ length: PREFILL_CAP + 3 }, (_, i) =>
      contact(`teammate${i}@macro.com`)
    );
    expect(
      prefillableTeammates({
        contacts,
        domain: 'macro.com',
        ownEmail: 'me@macro.com',
      })
    ).toHaveLength(PREFILL_CAP);
  });
});

describe('removeInviteSlot', () => {
  it('drops the row at the index, keeping one empty row when the last goes', () => {
    expect(removeInviteSlot(['a@macro.com', 'b@macro.com', ''], 1)).toEqual([
      'a@macro.com',
      '',
    ]);
    expect(removeInviteSlot(['a@macro.com'], 0)).toEqual(['']);
  });
});

describe('validInviteEmails', () => {
  it('trims, dedupes, and drops blanks, junk, and the user themselves', () => {
    expect(
      validInviteEmails(
        [' ada@macro.com ', 'ada@macro.com', '', 'nope', 'me@macro.com'],
        'me@macro.com'
      )
    ).toEqual(['ada@macro.com']);
  });
});
