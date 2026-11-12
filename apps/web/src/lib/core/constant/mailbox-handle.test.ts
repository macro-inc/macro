import { describe, expect, it } from 'vitest';
import { isAllowedHandle, mailboxAddress } from './mailbox-handle';

describe('mailbox handles', () => {
  it('accepts ada and rejects invalid or reserved forms', () => {
    expect(isAllowedHandle('ada')).toBe(true);
    for (const handle of ['ab', 'admin', 'ada@rox.one', '..ada']) {
      expect(isAllowedHandle(handle)).toBe(false);
    }
  });

  it('uses the first-party domain', () => {
    expect(mailboxAddress('ada')).toBe('ada@rox.one');
  });
});
