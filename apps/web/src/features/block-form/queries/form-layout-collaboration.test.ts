import { describe, expect, it } from 'vitest';
import { FormFlushError } from './form-collaboration';
import { flushFailureOf } from './form-layout-collaboration';

describe('flushFailureOf', () => {
  it('says why the layout isn’t published, naming what respondents still see', () => {
    expect(
      flushFailureOf(new FormFlushError({ kind: 'offline' })).message
    ).toBe('You’re offline. Your changes are kept on this device.');
    expect(
      flushFailureOf(new FormFlushError({ kind: 'unsaved', pending: 2 }))
        .message
    ).toBe(
      'Some changes haven’t reached the server yet. They’re kept on this device.'
    );
    expect(
      flushFailureOf(
        new FormFlushError({
          kind: 'publication',
          message: 'Screener “Eligibility” checks a question asked after it.',
        })
      )
    ).toEqual({
      message:
        'Respondents still see the last valid version of this form. Screener “Eligibility” checks a question asked after it.',
      refusal: 'invalid-layout',
    });
    expect(flushFailureOf(new Error('socket closed')).message).toBe(
      'socket closed'
    );
  });
});
