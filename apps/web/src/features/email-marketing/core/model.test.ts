import { describe, expect, it } from 'vitest';
import { mergeContacts, personalize } from './model';

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
