import { describe, expect, it } from 'vitest';
import {
  isAllowedHandle,
  mailboxAddress,
  ROX_MAIL_DOMAIN,
} from './mailbox-handle';

describe('mailbox handles', () => {
  it('accepts ada and rejects invalid or reserved forms', () => {
    expect(isAllowedHandle('ada')).toBe(true);
    for (const handle of ['ab', 'admin', 'ada@example.com', '..ada']) {
      expect(isAllowedHandle(handle)).toBe(false);
    }
  });

  it('uses the first-party domain', () => {
    expect(ROX_MAIL_DOMAIN).toBe('rox.one');
    expect(mailboxAddress('ada')).toBe(`ada@${ROX_MAIL_DOMAIN}`);
  });
});
