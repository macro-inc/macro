import { afterEach, describe, expect, it } from 'vitest';
import {
  type Campaign,
  MAX_SEQUENCE_CHARACTERS,
  mergeContacts,
  personalize,
  planSteps,
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
    ).toThrow('too long');
  });
});
