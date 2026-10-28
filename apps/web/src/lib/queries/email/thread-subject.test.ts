import { describe, expect, it } from 'vitest';
import { representativeThreadMessage } from './thread-subject';

describe('representativeThreadMessage', () => {
  it('returns undefined for an empty thread', () => {
    expect(representativeThreadMessage([])).toBeUndefined();
  });

  it('takes the subject-bearing message when the newest message is a draft with no subject', () => {
    // Newest-first: an unsent draft reply floats to the head with no subject.
    const messages = [
      { subject: '', is_draft: true },
      { subject: '$1000 in credits from Macro', is_draft: false },
    ];
    expect(representativeThreadMessage(messages)?.subject).toBe(
      '$1000 in credits from Macro'
    );
  });

  it('skips a null-subject draft', () => {
    const messages = [
      { subject: null, is_draft: true },
      { subject: 'Real subject', is_draft: false },
    ];
    expect(representativeThreadMessage(messages)?.subject).toBe('Real subject');
  });

  it('prefers the newest non-draft with a subject over an older one', () => {
    const messages = [
      { subject: 'Re: Newer', is_draft: false },
      { subject: 'Older', is_draft: false },
    ];
    expect(representativeThreadMessage(messages)?.subject).toBe('Re: Newer');
  });

  it('falls back to a draft subject when no sent message has one', () => {
    const messages = [
      { subject: '   ', is_draft: false },
      { subject: 'Draft subject', is_draft: true },
    ];
    expect(representativeThreadMessage(messages)?.subject).toBe(
      'Draft subject'
    );
  });

  it('falls back to the newest message when nothing has a subject', () => {
    const messages = [
      { subject: '', is_draft: true },
      { subject: null, is_draft: false },
    ];
    expect(representativeThreadMessage(messages)).toBe(messages[0]);
  });
});
