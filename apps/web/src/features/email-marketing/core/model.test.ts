import { afterEach, describe, expect, it } from 'vitest';
import {
  type Campaign,
  MAX_SEQUENCE_CHARACTERS,
  mergeContacts,
  personalize,
  planSteps,
  replyParent,
  validateCampaign,
} from './model';

const systemTimeZone = process.env.TZ;
afterEach(() => {
  process.env.TZ = systemTimeZone;
});
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
  it('merges Gmail names with CRM identity and deduplicates case-insensitively', () => {
    expect(
      mergeContacts([
        { email: 'ADA@Example.com', name: 'Ada' },
        {
          email: 'ada@example.com',
          name: '',
          crmContactId: 'crm-id',
          companyId: 'company-id',
        },
        { email: 'invalid', name: 'Invalid' },
      ])
    ).toEqual([
      {
        email: 'ada@example.com',
        name: 'Ada',
        crmContactId: 'crm-id',
        companyId: 'company-id',
      },
    ]);
  });
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
  it('keeps the local send time across a daylight-saving change', () => {
    process.env.TZ = 'America/New_York';
    // Nov 1 2026 is the US fall-back day.
    const steps = planSteps(
      campaign,
      { email: 'ada@example.com', name: 'Ada' },
      new Date('2026-10-30T09:00:00-04:00')
    );
    expect(steps.map((step) => step.sendAt)).toEqual([
      '2026-10-30T13:00:00.000Z',
      '2026-11-02T14:00:00.000Z',
    ]);
  });
  it('rejects sequences too long to store in one enrollment record', () => {
    const half = 'x'.repeat(MAX_SEQUENCE_CHARACTERS / 2);
    expect(() =>
      validateCampaign({
        ...campaign,
        steps: [
          { id: 'one', delayDays: 0, subject: 'Hi', body: half },
          { id: 'two', delayDays: 1, subject: 'Again', body: half },
        ],
      })
    ).toThrow(expect.objectContaining({ code: 'sequenceTooLong' }));
  });
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
  it('requires subjects only where an email starts a thread', () => {
    expect(() =>
      validateCampaign({
        ...campaign,
        steps: [
          campaign.steps[0],
          { id: 'two', delayDays: 1, subject: '', body: 'B', asReply: true },
        ],
      })
    ).not.toThrow();
    expect(() =>
      validateCampaign({
        ...campaign,
        steps: [{ ...campaign.steps[0], asReply: true, subject: '' }],
      })
    ).toThrow(expect.objectContaining({ code: 'subjectRequired' }));
  });
  it('rejects malformed personalization, including in the opt-out line', () => {
    for (const subject of [
      'Hi {{firstName}',
      'Hi {{ first name }}',
      'Hi firstName}}',
    ])
      expect(() =>
        validateCampaign({
          ...campaign,
          steps: [{ ...campaign.steps[0], subject }],
        })
      ).toThrow(expect.objectContaining({ code: 'unknownPersonalization' }));
    expect(() =>
      validateCampaign({ ...campaign, optOutLine: 'Reply {{stop}}' })
    ).toThrow(expect.objectContaining({ code: 'unknownPersonalization' }));
  });
  it('keeps a personalized subject on one line whatever the contact’s name holds', () => {
    const [step] = planSteps(
      {
        ...campaign,
        steps: [{ id: 'one', delayDays: 0, subject: 'Hi {{name}}', body: 'A' }],
      },
      { email: 'ada@example.com', name: 'Ada\r\nBcc: someone@example.com' },
      new Date('2026-10-30T09:00:00Z')
    );
    expect(step.subject).toBe('Hi Ada Bcc: someone@example.com');
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
