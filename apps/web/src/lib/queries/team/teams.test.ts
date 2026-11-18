import { describe, expect, it, vi } from 'vitest';
import { shouldSendDomainNotice } from './teams';

vi.mock('@service-auth/client', () => ({ authServiceClient: {} }));

const DOMAIN_TEAM = { auto_join_domain: 'acme.com' };

describe('shouldSendDomainNotice', () => {
  it('sends when domain join and the notice are both on', () => {
    expect(
      shouldSendDomainNotice(
        { allowDomainJoin: true, notifyDomain: true },
        DOMAIN_TEAM
      )
    ).toBe(true);
  });

  it('skips when the notice is off', () => {
    expect(
      shouldSendDomainNotice(
        { allowDomainJoin: true, notifyDomain: false },
        DOMAIN_TEAM
      )
    ).toBe(false);
  });

  it('skips without domain join, whatever the notice choice', () => {
    expect(
      shouldSendDomainNotice(
        { allowDomainJoin: false, notifyDomain: true },
        DOMAIN_TEAM
      )
    ).toBe(false);
  });

  it('skips when neither is chosen, as Settings team creation does', () => {
    expect(shouldSendDomainNotice({}, DOMAIN_TEAM)).toBe(false);
  });

  it('skips when the team got no auto-join domain', () => {
    expect(
      shouldSendDomainNotice(
        { allowDomainJoin: true, notifyDomain: true },
        { auto_join_domain: null }
      )
    ).toBe(false);
  });
});
