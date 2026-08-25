import { describe, expect, it } from 'vitest';
import {
  addressDomain,
  externalParties,
  groupPartiesByDomain,
} from './parties';

describe('addressDomain', () => {
  it('lowercases and trims the domain part', () => {
    expect(addressDomain('  Jane@Acme.COM ')).toBe('acme.com');
  });

  it('returns undefined for addresses without a usable domain', () => {
    expect(addressDomain(undefined)).toBeUndefined();
    expect(addressDomain('')).toBeUndefined();
    expect(addressDomain('jane')).toBeUndefined();
    expect(addressDomain('@acme.com')).toBeUndefined();
    expect(addressDomain('jane@')).toBeUndefined();
  });
});

describe('externalParties', () => {
  const self = 'me@macro.com';

  it('drops the signed-in user and same-domain teammates', () => {
    expect(
      externalParties(
        [
          { email: 'me@macro.com' },
          { email: 'teammate@macro.com', name: 'Team Mate' },
          { email: 'jane@acme.com', name: 'Jane' },
        ],
        self
      )
    ).toEqual([{ email: 'jane@acme.com', name: 'Jane' }]);
  });

  it('matches the user and their domain case-insensitively', () => {
    expect(
      externalParties(
        [{ email: 'ME@Macro.com' }, { email: 'Teammate@MACRO.com' }],
        'me@macro.com'
      )
    ).toEqual([]);
  });

  it('dedupes on the address, keeping the first display name it sees', () => {
    expect(
      externalParties(
        [
          { email: 'jane@acme.com' },
          { email: 'Jane@Acme.com', name: 'Jane Doe' },
          { email: 'jane@acme.com', name: 'J. Doe' },
        ],
        self
      )
    ).toEqual([{ email: 'jane@acme.com', name: 'Jane Doe' }]);
  });

  it('treats blank display names as absent', () => {
    expect(
      externalParties([{ email: 'jane@acme.com', name: '   ' }], self)
    ).toEqual([{ email: 'jane@acme.com', name: undefined }]);
  });

  it('skips malformed addresses', () => {
    expect(
      externalParties([{ email: 'not-an-address' }, { email: '' }], self)
    ).toEqual([]);
  });

  it('returns nothing when the signed-in address is unknown', () => {
    const parties = [{ email: 'jane@acme.com' }];
    expect(externalParties(parties, undefined)).toEqual([]);
    expect(externalParties(parties, 'nodomain')).toEqual([]);
  });
});

describe('groupPartiesByDomain', () => {
  it('buckets parties by domain in first-seen order', () => {
    expect(
      groupPartiesByDomain([
        { email: 'jane@acme.com', name: 'Jane' },
        { email: 'bo@globex.com' },
        { email: 'ann@acme.com' },
      ])
    ).toEqual([
      {
        domain: 'acme.com',
        parties: [
          { email: 'jane@acme.com', name: 'Jane' },
          { email: 'ann@acme.com' },
        ],
      },
      { domain: 'globex.com', parties: [{ email: 'bo@globex.com' }] },
    ]);
  });

  it('skips parties without a usable domain', () => {
    expect(groupPartiesByDomain([{ email: 'nodomain' }])).toEqual([]);
  });
});
