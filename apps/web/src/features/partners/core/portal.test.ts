import { describe, expect, it } from 'vitest';
import {
  acceptedPartnerForEmail,
  centsFromDollars,
  columnsByTeam,
  draftPartner,
  draftReferral,
  draftSeat,
  draftTeam,
  inGoodStanding,
  isMacroStaff,
  type Partner,
  referralFeeCents,
  seedPortal,
} from './portal';

const accepted: Partner = {
  id: 'partner-northwind',
  name: 'Ada Okonkwo',
  email: 'ada@northwind.example',
  organization: 'Northwind Studio',
  status: 'accepted',
  taxForm: 'w9',
  paymentDetails: true,
  directory: true,
  seat: null,
  granted: true,
};

describe('partner portal rules', () => {
  it('estimates the fee as 30% of first-year revenue', () => {
    expect(referralFeeCents(1_200_000)).toBe(360_000);
    expect(centsFromDollars('12.5')).toBe(1250);
    expect(centsFromDollars('')).toBeNull();
    expect(centsFromDollars('0')).toBeNull();
    expect(centsFromDollars('nope')).toBeUndefined();
  });

  it('treats a matching email as a self-referral and rejects a duplicate', () => {
    const claimedAt = '2026-11-16';
    const self = draftReferral(accepted, [], {
      name: 'Ada Okonkwo',
      email: 'Ada@northwind.example',
      organization: 'Northwind Studio',
      claimedAt,
    });
    expect(self.ok).toBe(true);
    if (!self.ok) return;
    expect(self.referral.status).toBe('ineligible');
    expect(self.referral.ineligibleReason).toBe('self');

    const duplicate = draftReferral(
      accepted,
      [{ ...self.referral, id: 'referral-1' }],
      {
        name: 'Someone else',
        email: 'ada@northwind.example',
        organization: '',
        claimedAt,
      }
    );
    expect(duplicate).toEqual({ ok: false, error: 'duplicate' });
  });

  it('refuses referrals from a partner who is not accepted', () => {
    const result = draftReferral({ ...accepted, status: 'suspended' }, [], {
      name: 'Jordan Lee',
      email: 'jordan@brightlane.example',
      organization: 'Brightlane',
      claimedAt: '2026-11-16',
    });
    expect(result).toEqual({ ok: false, error: 'unavailable' });
  });

  it('adds a partner as accepted and blocks a second copy of the email', () => {
    const created = draftPartner([], {
      name: 'Sam Herrera',
      email: 'Sam@harbor.example',
      organization: 'Harbor & Co',
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.partner.status).toBe('accepted');
    expect(created.partner.email).toBe('sam@harbor.example');
    expect(created.partner.taxForm).toBe('missing');

    const again = draftPartner([{ ...created.partner, id: 'partner-harbor' }], {
      name: 'Sam',
      email: 'sam@harbor.example',
      organization: '',
    });
    expect(again).toEqual({ ok: false, error: 'duplicate' });
  });

  it('gives an accepted partner one free seat for someone else', () => {
    const filled = draftSeat(accepted, {
      name: 'Miles Okonkwo',
      email: 'Miles@northwind.example',
    });
    expect(filled).toEqual({
      ok: true,
      seat: { name: 'Miles Okonkwo', email: 'miles@northwind.example' },
    });
    expect(
      draftSeat(accepted, {
        name: 'Ada Okonkwo',
        email: 'ada@northwind.example',
      })
    ).toEqual({ ok: false, error: 'self' });
    expect(
      draftSeat(
        { ...accepted, status: 'applied' },
        {
          name: 'Miles Okonkwo',
          email: 'miles@northwind.example',
        }
      )
    ).toEqual({ ok: false, error: 'unavailable' });
    expect(seedPortal().partners[0]?.seat?.email).toBe(
      'miles@northwind.example'
    );
  });

  it('requires acceptance, a tax form, and payment details for good standing', () => {
    expect(inGoodStanding(accepted)).toBe(true);
    expect(inGoodStanding({ ...accepted, taxForm: 'missing' })).toBe(false);
    expect(inGoodStanding({ ...accepted, paymentDetails: false })).toBe(false);
    expect(inGoodStanding({ ...accepted, status: 'suspended' })).toBe(false);
  });

  it('matches an accepted partner by email and recognizes staff accounts', () => {
    const data = seedPortal();
    expect(
      acceptedPartnerForEmail(data, 'Ada@northwind.example')
    ).toBeUndefined();
    expect(
      acceptedPartnerForEmail(
        {
          ...data,
          partners: data.partners.map((partner) =>
            partner.id === 'partner-northwind'
              ? { ...partner, granted: true }
              : partner
          ),
        },
        'Ada@northwind.example'
      )?.id
    ).toBe('partner-northwind');
    expect(
      acceptedPartnerForEmail(data, 'renee@lumen.example')
    ).toBeUndefined();
    expect(isMacroStaff('Staff@Macro.com')).toBe(true);
    expect(isMacroStaff('ada@northwind.example')).toBe(false);
    expect(isMacroStaff(`user@partners.${'macro.com'}`)).toBe(false);
  });

  it('keeps a team’s member count separate from how many people were referred', () => {
    const data = seedPortal();
    const columns = columnsByTeam(
      data.referrals.filter(
        (referral) => referral.partnerId === 'partner-northwind'
      ),
      data.teams.filter((team) => team.partnerId === 'partner-northwind')
    );
    const brightlane = columns.find((column) => column.name === 'Brightlane');
    expect(brightlane?.memberCount).toBe(12);
    expect(brightlane?.referrals.map((referral) => referral.tier)).toEqual([
      'premium',
      'max',
    ]);
    expect(draftTeam({ name: '  ', memberCount: 3 })).toEqual({
      ok: false,
      error: 'invalid',
    });
    expect(draftTeam({ name: 'North', memberCount: 0 })).toEqual({
      ok: false,
      error: 'invalid',
    });
  });
});
