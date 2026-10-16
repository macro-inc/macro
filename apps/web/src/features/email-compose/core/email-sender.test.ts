import { describe, expect, it } from 'vitest';
import { message } from '../../email-message/tests/messages';
import { fromInboxOptions, replySenderAddress } from './email-sender';

const inbox = {
  id: 'inbox',
  email_address: 'base@example.com',
  sendAs: [
    { email_address: 'resident@example.com', displayName: 'Resident' },
    { email_address: 'BASE@example.com' },
    { email_address: 'RESIDENT@example.com' },
  ],
};

describe('email sender identities', () => {
  it('deduplicates case-insensitively within an inbox without merging different inboxes', () => {
    const options = fromInboxOptions([inbox, { ...inbox, id: 'delegated' }]);
    expect(options).toHaveLength(4);
    expect(new Set(options.map((option) => option.id)).size).toBe(4);
    expect(options.filter((option) => option.isAlias)).toHaveLength(2);
  });
  it.each(['to', 'cc', 'bcc'] as const)(
    'defaults to the verified alias in %s',
    (field) => {
      expect(
        replySenderAddress(
          inbox,
          message('parent', {
            to: [],
            cc: [],
            bcc: [],
            [field]: [{ email: 'RESIDENT@example.com' }],
          })
        )
      ).toBe('resident@example.com');
    }
  );
  it('preserves the base address for direct mail and prefers To over Cc', () => {
    expect(
      replySenderAddress(
        inbox,
        message('parent', {
          to: [{ email: 'base@example.com' }],
          cc: [{ email: 'resident@example.com' }],
        })
      )
    ).toBe('base@example.com');
  });
  it('prefers an alias over the base address when both are To recipients', () => {
    expect(
      replySenderAddress(
        inbox,
        message('parent', {
          to: [
            { email: 'base@example.com' },
            { email: 'resident@example.com' },
          ],
        })
      )
    ).toBe('resident@example.com');
  });
  it('continues outgoing chains from the previous sender', () => {
    expect(
      replySenderAddress(
        inbox,
        message('sent', {
          from: { email: 'Resident@example.com' },
          to: [{ email: 'customer@example.com' }],
        })
      )
    ).toBe('resident@example.com');
  });
  it('keeps healthy inbox aliases if another inbox lookup failed', () => {
    expect(
      fromInboxOptions([
        inbox,
        { id: 'unavailable', email_address: 'other@example.com', sendAs: null },
      ])
    ).toHaveLength(3);
  });
});
