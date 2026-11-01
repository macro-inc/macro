import { describe, expect, it } from 'vitest';
import { type Campaign, personalize, planSteps, replyParent } from './model';

const campaign: Campaign = {
  id: 'campaign',
  name: 'Welcome',
  description: '',
  status: 'draft',
  senderId: 'inbox',
  updatedAt: '2026-10-01T00:00:00Z',
  steps: [
    { id: 'one', delayDays: 0, subject: 'Hi', body: 'Hello' },
    { id: 'two', delayDays: 3, subject: 'Again', body: 'Hello again' },
  ],
};

describe('shared audience', () => {
  it('handles missing names without leaking an unfilled greeting token', () => {
    expect(
      personalize('Hi {{firstName}}, {{ email }}', {
        email: 'ada@example.com',
        name: '',
      })
    ).toBe('Hi there, ada@example.com');
  });
});

describe('sequence planning', () => {
  it('replies in the first email’s thread and ends every email with the opt-out line', () => {
    const steps = planSteps(
      {
        ...campaign,
        optOutLine: 'Reply STOP to opt out.',
        steps: [
          { id: 'one', delayDays: 0, subject: 'Hi {{firstName}}', body: 'A' },
          { id: 'two', delayDays: 1, subject: '', body: 'B', asReply: true },
          { id: 'three', delayDays: 1, subject: 'New', body: 'C' },
          { id: 'four', delayDays: 1, subject: '', body: 'D', asReply: true },
        ],
      },
      { email: 'ada@example.com', name: 'Ada' },
      new Date('2026-10-30T09:00:00Z')
    );
    expect(steps.map((step) => step.subject)).toEqual([
      'Hi Ada',
      'Re: Hi Ada',
      'New',
      'Re: New',
    ]);
    expect(steps[0].body).toBe('A\n\nReply STOP to opt out.');
  });
  it('replies to the nearest earlier email that was queued or sent', () => {
    const steps = planSteps(
      {
        ...campaign,
        steps: [
          { id: 'one', delayDays: 0, subject: 'Hi', body: 'A' },
          { id: 'two', delayDays: 1, subject: '', body: 'B', asReply: true },
          { id: 'three', delayDays: 1, subject: '', body: 'C', asReply: true },
        ],
      },
      { email: 'ada@example.com', name: 'Ada' },
      new Date('2026-10-30T09:00:00Z')
    );
    steps[0] = { ...steps[0], status: 'delivery_started', draftId: 'sent' };
    steps[1] = { ...steps[1], status: 'canceled', draftId: 'gone' };
    expect(replyParent(steps, 0)).toBeUndefined();
    expect(replyParent(steps, 2)).toBe('sent');
  });
});
