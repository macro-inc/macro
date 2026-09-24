import { describe, expect, it } from 'vitest';
import { resolveGoogleAccounts } from './googleAccounts';

const work = {
  email_address: 'work@company.com',
  macro_id: 'user',
  needs_reauth: false,
};
const personal = {
  email_address: 'personal@gmail.com',
  macro_id: 'user',
  needs_reauth: false,
};

describe('required work identity', () => {
  it('requires an owned healthy inbox matching the account, regardless of order or case', () => {
    const state = resolveGoogleAccounts(
      [personal, work],
      'user',
      'WORK@company.com'
    );
    expect(state.workConnected).toBe(true);
    expect(state.work).toBe(work);
    expect(state.personal).toBe(personal);
  });
  it('does not let a shared or personal inbox satisfy required work', () => {
    expect(
      resolveGoogleAccounts(
        [personal, { ...work, macro_id: 'other' }],
        'user',
        work.email_address
      ).workConnected
    ).toBe(false);
  });
  it('requires reconnect after permissions expire and does not count work twice', () => {
    expect(
      resolveGoogleAccounts(
        [{ ...work, needs_reauth: true }],
        'user',
        work.email_address
      ).workConnected
    ).toBe(false);
    expect(
      resolveGoogleAccounts([work, { ...work }], 'user', work.email_address)
        .personal
    ).toBeUndefined();
  });
  it('stays incomplete before identity and links load', () => {
    expect(
      resolveGoogleAccounts([work], undefined, undefined).workConnected
    ).toBe(false);
    expect(
      resolveGoogleAccounts([], 'user', work.email_address).workConnected
    ).toBe(false);
  });
});
