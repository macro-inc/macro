import { describe, expect, it } from 'vitest';
import { type ThreadMessage, threadFacts, waitingFor } from './thread';

const received: ThreadMessage = {
  id: 'm1',
  isDraft: false,
  isSent: false,
  at: '2026-11-07T09:00:00Z',
  from: 'Priya Shah',
};
const draft: ThreadMessage = {
  id: 'draft-1',
  isDraft: true,
  isSent: false,
  at: '2026-11-09T04:00:00Z',
  text: ' Approved, thanks. ',
};

describe('threadFacts', () => {
  it('reads the draft, who wrote last and since when they wait', () => {
    expect(threadFacts([draft, received], 'draft-1')).toEqual({
      draftText: 'Approved, thanks.',
      sender: 'Priya Shah',
      waitingSince: '2026-11-07T09:00:00Z',
    });
  });

  it('says nobody waits once the person answered last', () => {
    const answered: ThreadMessage = {
      id: 'm2',
      isDraft: false,
      isSent: true,
      at: '2026-11-08T09:00:00Z',
    };

    expect(threadFacts([received, answered], undefined)).toEqual({
      draftText: undefined,
      sender: 'Priya Shah',
      waitingSince: undefined,
    });
  });
});

describe('waitingFor', () => {
  const now = new Date('2026-11-09T09:30:00Z');

  it('counts whole days, then hours, and nothing under an hour', () => {
    expect(waitingFor('2026-11-07T09:00:00Z', now)).toEqual({
      unit: 'days',
      count: 2,
    });
    expect(waitingFor('2026-11-09T04:00:00Z', now)).toEqual({
      unit: 'hours',
      count: 5,
    });
    expect(waitingFor('2026-11-09T09:00:00Z', now)).toBeUndefined();
    expect(waitingFor('not a date', now)).toBeUndefined();
  });
});
