import { describe, expect, it } from 'vitest';
import { collectEmailParticipants } from './participants';

describe('collectEmailParticipants', () => {
  it('lists each sender and To/Cc recipient once, in first-seen order', () => {
    const participants = collectEmailParticipants([
      {
        from: { email: 'ada@example.com', name: 'Ada' },
        to: [{ email: 'grace@example.org' }],
        cc: [{ email: 'alan@example.net', name: 'Alan' }],
      },
      {
        from: { email: 'grace@example.org', name: 'Grace', photo_url: 'g.png' },
        to: [{ email: 'ada@example.com' }],
        cc: [],
      },
    ]);

    expect(participants).toEqual([
      {
        email: 'ada@example.com',
        name: 'Ada',
        photoUrl: undefined,
        role: 'from',
      },
      {
        email: 'grace@example.org',
        name: 'Grace',
        photoUrl: 'g.png',
        role: 'from',
      },
      {
        email: 'alan@example.net',
        name: 'Alan',
        photoUrl: undefined,
        role: 'cc',
      },
    ]);
  });

  it('keeps the first recipient role and a known name and photo', () => {
    const participants = collectEmailParticipants([
      {
        from: null,
        to: [{ email: 'ada@example.com', name: 'Ada', photo_url: 'a.png' }],
        cc: [],
      },
      {
        from: null,
        to: [],
        cc: [{ email: 'ada@example.com' }],
      },
    ]);

    expect(participants).toEqual([
      { email: 'ada@example.com', name: 'Ada', photoUrl: 'a.png', role: 'to' },
    ]);
  });
});
