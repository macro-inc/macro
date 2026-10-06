import { describe, expect, it } from 'vitest';
import { type EmailAccount, orderEmailAccounts } from './email-accounts';

const account = (
  address: string,
  isPrimary: boolean,
  ownerId = 'me'
): EmailAccount => ({ address, isPrimary, ownerId });

describe('orderEmailAccounts', () => {
  it('puts the viewer’s own primary inbox first and keeps shared inboxes', () => {
    expect(
      orderEmailAccounts(
        [
          account('shared@co.com', true, 'someone-else'),
          account('personal@gmail.com', false),
          account('work@co.com', true),
        ],
        'me'
      ).map((item) => item.address)
    ).toEqual(['work@co.com', 'shared@co.com', 'personal@gmail.com']);
  });
});
