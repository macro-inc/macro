export type PartnerStatus = 'applied' | 'accepted' | 'suspended';

export type TaxForm = 'missing' | 'w9' | 'w8';

export type ReferralStatus =
  | 'submitted'
  | 'accepted'
  | 'paying'
  | 'rejected'
  | 'ineligible';

export type PayoutStatus = 'scheduled' | 'paid' | 'withheld' | 'rolled';

export type PayoutNote = 'preview' | 'withheldTax' | 'rolled';

/** Same identifiers as the product plans. `premium` is shown as Pro. */
export type PricingTier = 'free' | 'premium' | 'max';

export const PIPELINE_STAGES = [
  'submitted',
  'accepted',
  'paying',
  'rejected',
  'ineligible',
] as const satisfies readonly ReferralStatus[];

/** A customer team a referred person joined. Member count is the team size. */
export type CustomerTeam = {
  id: string;
  partnerId: string;
  name: string;
  memberCount: number;
};

/** The one free teammate an accepted partner can add. */
export type TeamSeat = {
  name: string;
  email: string;
};

export type Partner = {
  id: string;
  name: string;
  email: string;
  organization: string;
  status: PartnerStatus;
  taxForm: TaxForm;
  paymentDetails: boolean;
  directory: boolean;
  seat: TeamSeat | null;
  /** Staff added or accepted this partner, so that account can open the portal. */
  granted: boolean;
};

export type Referral = {
  id: string;
  partnerId: string;
  name: string;
  email: string;
  organization: string;
  status: ReferralStatus;
  claimedAt: string;
  firstYearRevenueCents: number | null;
  ineligibleReason: 'self' | null;
  teamId: string | null;
  tier: PricingTier;
};

export type Payout = {
  id: string;
  partnerId: string;
  year: number;
  quarter: 1 | 2 | 3 | 4;
  amountCents: number;
  status: PayoutStatus;
  note: PayoutNote;
};

export type PortalData = {
  partners: Partner[];
  referrals: Referral[];
  payouts: Payout[];
  teams: CustomerTeam[];
};

export type PortalError = 'invalid' | 'duplicate' | 'unavailable';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isMacroStaff(email: string | undefined): boolean {
  return email?.trim().toLowerCase().endsWith('@macro.com') ?? false;
}

export function inGoodStanding(partner: Partner): boolean {
  return (
    partner.status === 'accepted' &&
    partner.taxForm !== 'missing' &&
    partner.paymentDetails
  );
}

/** 30% of first-year net subscription revenue, in cents. */
export function referralFeeCents(revenueCents: number): number {
  return Math.round(revenueCents * 0.3);
}

/**
 * `null` clears a recorded amount. `undefined` means the text is not a dollar
 * amount. Zero is treated as clearing the amount.
 */
export function centsFromDollars(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const amount = Number(trimmed);
  if (!Number.isFinite(amount) || amount < 0) return undefined;
  if (amount === 0) return null;
  return Math.round(amount * 100);
}

export function acceptedPartnerForEmail(
  data: PortalData,
  email: string | undefined
): Partner | undefined {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return undefined;
  return data.partners.find(
    (partner) =>
      partner.granted &&
      partner.status === 'accepted' &&
      partner.email === normalized
  );
}

export function draftPartner(
  existing: readonly Partner[],
  input: { name: string; email: string; organization: string }
):
  | { ok: true; partner: Omit<Partner, 'id'> }
  | { ok: false; error: 'invalid' | 'duplicate' } {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name || !EMAIL.test(email)) return { ok: false, error: 'invalid' };
  if (existing.some((partner) => partner.email === email)) {
    return { ok: false, error: 'duplicate' };
  }
  return {
    ok: true,
    partner: {
      name,
      email,
      organization: input.organization.trim(),
      status: 'accepted',
      taxForm: 'missing',
      paymentDetails: false,
      directory: false,
      seat: null,
      granted: true,
    },
  };
}

export function draftSeat(
  partner: Partner,
  input: { name: string; email: string }
):
  | { ok: true; seat: TeamSeat }
  | { ok: false; error: 'invalid' | 'self' | 'unavailable' } {
  if (partner.status !== 'accepted') {
    return { ok: false, error: 'unavailable' };
  }
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name || !EMAIL.test(email)) return { ok: false, error: 'invalid' };
  if (email === partner.email) return { ok: false, error: 'self' };
  return { ok: true, seat: { name, email } };
}

export function draftReferral(
  partner: Partner,
  existing: readonly Referral[],
  input: {
    name: string;
    email: string;
    organization: string;
    claimedAt: string;
  }
):
  | { ok: true; referral: Omit<Referral, 'id'> }
  | { ok: false; error: PortalError } {
  if (partner.status !== 'accepted') {
    return { ok: false, error: 'unavailable' };
  }
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name || !EMAIL.test(email)) return { ok: false, error: 'invalid' };
  if (
    existing.some(
      (referral) =>
        referral.partnerId === partner.id && referral.email === email
    )
  ) {
    return { ok: false, error: 'duplicate' };
  }
  const self = email === partner.email;
  return {
    ok: true,
    referral: {
      partnerId: partner.id,
      name,
      email,
      organization: input.organization.trim(),
      status: self ? 'ineligible' : 'submitted',
      claimedAt: input.claimedAt,
      firstYearRevenueCents: null,
      ineligibleReason: self ? 'self' : null,
      teamId: null,
      tier: 'free',
    },
  };
}

export function draftTeam(input: {
  name: string;
  memberCount: number;
}):
  | { ok: true; team: { name: string; memberCount: number } }
  | { ok: false; error: 'invalid' } {
  const name = input.name.trim();
  if (!name || !Number.isInteger(input.memberCount) || input.memberCount < 1) {
    return { ok: false, error: 'invalid' };
  }
  return { ok: true, team: { name, memberCount: input.memberCount } };
}

export function columnsByStage(referrals: readonly Referral[]): {
  stage: ReferralStatus;
  referrals: Referral[];
}[] {
  return PIPELINE_STAGES.map((stage) => ({
    stage,
    referrals: referrals.filter((referral) => referral.status === stage),
  }));
}

export type TeamColumn = {
  teamId: string | null;
  name: string;
  memberCount: number | null;
  referrals: Referral[];
};

/** Teams stay as columns even when empty. Member count is the team size. */
export function columnsByTeam(
  referrals: readonly Referral[],
  teams: readonly CustomerTeam[]
): TeamColumn[] {
  const columns: TeamColumn[] = [...teams]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((team) => ({
      teamId: team.id,
      name: team.name,
      memberCount: team.memberCount,
      referrals: referrals.filter((referral) => referral.teamId === team.id),
    }));
  const unassigned = referrals.filter((referral) => referral.teamId === null);
  if (unassigned.length > 0) {
    columns.push({
      teamId: null,
      name: '',
      memberCount: null,
      referrals: unassigned,
    });
  }
  return columns;
}

export function seedPortal(): PortalData {
  return {
    partners: [
      {
        id: 'partner-northwind',
        name: 'Ada Okonkwo',
        email: 'ada@northwind.example',
        organization: 'Northwind Studio',
        status: 'accepted',
        taxForm: 'w9',
        paymentDetails: true,
        directory: true,
        seat: {
          name: 'Miles Okonkwo',
          email: 'miles@northwind.example',
        },
        granted: false,
      },
      {
        id: 'partner-harbor',
        name: 'Sam Herrera',
        email: 'sam@harbor.example',
        organization: 'Harbor & Co',
        status: 'applied',
        taxForm: 'missing',
        paymentDetails: false,
        directory: false,
        seat: null,
        granted: false,
      },
      {
        id: 'partner-lumen',
        name: 'Renee Cho',
        email: 'renee@lumen.example',
        organization: 'Lumen Advisory',
        status: 'suspended',
        taxForm: 'missing',
        paymentDetails: false,
        directory: false,
        seat: null,
        granted: false,
      },
    ],
    referrals: [
      {
        id: 'referral-brightlane',
        partnerId: 'partner-northwind',
        name: 'Jordan Lee',
        email: 'jordan@brightlane.example',
        organization: 'Brightlane',
        status: 'paying',
        claimedAt: '2026-07-02',
        firstYearRevenueCents: 1_200_000,
        ineligibleReason: null,
        teamId: 'team-brightlane',
        tier: 'premium',
      },
      {
        id: 'referral-brightlane-casey',
        partnerId: 'partner-northwind',
        name: 'Casey Nguyen',
        email: 'casey@brightlane.example',
        organization: 'Brightlane',
        status: 'accepted',
        claimedAt: '2026-08-20',
        firstYearRevenueCents: null,
        ineligibleReason: null,
        teamId: 'team-brightlane',
        tier: 'max',
      },
      {
        id: 'referral-fieldnote',
        partnerId: 'partner-northwind',
        name: 'Priya Shah',
        email: 'priya@fieldnote.example',
        organization: 'Fieldnote',
        status: 'submitted',
        claimedAt: '2026-10-18',
        firstYearRevenueCents: null,
        ineligibleReason: null,
        teamId: 'team-fieldnote',
        tier: 'free',
      },
      {
        id: 'referral-lumen-self',
        partnerId: 'partner-lumen',
        name: 'Renee Cho',
        email: 'renee@lumen.example',
        organization: 'Lumen Advisory',
        status: 'ineligible',
        claimedAt: '2026-08-12',
        firstYearRevenueCents: null,
        ineligibleReason: 'self',
        teamId: null,
        tier: 'free',
      },
    ],
    teams: [
      {
        id: 'team-brightlane',
        partnerId: 'partner-northwind',
        name: 'Brightlane',
        memberCount: 12,
      },
      {
        id: 'team-fieldnote',
        partnerId: 'partner-northwind',
        name: 'Fieldnote',
        memberCount: 4,
      },
    ],
    payouts: [
      {
        id: 'payout-northwind-q1',
        partnerId: 'partner-northwind',
        year: 2026,
        quarter: 1,
        amountCents: 4_000,
        status: 'rolled',
        note: 'rolled',
      },
      {
        id: 'payout-northwind-q2',
        partnerId: 'partner-northwind',
        year: 2026,
        quarter: 2,
        amountCents: 90_000,
        status: 'paid',
        note: 'preview',
      },
      {
        id: 'payout-northwind-q3',
        partnerId: 'partner-northwind',
        year: 2026,
        quarter: 3,
        amountCents: 360_000,
        status: 'scheduled',
        note: 'preview',
      },
      {
        id: 'payout-lumen-q2',
        partnerId: 'partner-lumen',
        year: 2026,
        quarter: 2,
        amountCents: 15_000,
        status: 'withheld',
        note: 'withheldTax',
      },
    ],
  };
}
