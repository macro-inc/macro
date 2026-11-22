import { createRoot, createSignal } from 'solid-js';
import {
  draftPartner,
  draftReferral,
  draftSeat,
  draftTeam,
  type PartnerStatus,
  type Payout,
  type PortalData,
  type PortalError,
  type PricingTier,
  type Referral,
  type ReferralStatus,
  seedPortal,
  type TaxForm,
} from '../core/portal';

const STORAGE_KEY = 'macro:partner-portal:v1';

function isPortalData(value: unknown): value is PortalData {
  if (!value || typeof value !== 'object') return false;
  const data = value as PortalData;
  return (
    Array.isArray(data.partners) &&
    Array.isArray(data.referrals) &&
    Array.isArray(data.payouts)
  );
}

/** Older browser copies have no seat field. Sample partners pick up the seeded one. */
function withSeats(data: PortalData): PortalData {
  const seeded = new Map(
    seedPortal().partners.map((partner) => [partner.id, partner.seat])
  );
  let filled = false;
  const partners = data.partners.map((partner) => {
    if ('seat' in partner && partner.seat !== undefined) return partner;
    filled = true;
    return { ...partner, seat: seeded.get(partner.id) ?? null };
  });
  const next = filled ? { ...data, partners } : data;
  if (filled) writeStored(next);
  return next;
}

const TIERS: readonly PricingTier[] = ['free', 'premium', 'max'];

function isPricingTier(value: unknown): value is PricingTier {
  return TIERS.some((tier) => tier === value);
}

/**
 * Older browser copies have no teams, and referrals have no team or tier.
 * Sample referrals pick up the seeded placement.
 */
function withPipeline(data: PortalData): PortalData {
  const seed = seedPortal();
  const seeded = new Map(
    seed.referrals.map((referral) => [referral.id, referral])
  );
  let filled = !Array.isArray(data.teams);
  const teams = filled ? seed.teams : data.teams;
  const referrals = data.referrals.map((referral) => {
    const sample = seeded.get(referral.id);
    const teamId =
      'teamId' in referral && referral.teamId !== undefined
        ? referral.teamId
        : (sample?.teamId ?? null);
    const tier = isPricingTier(referral.tier)
      ? referral.tier
      : (sample?.tier ?? 'free');
    if (teamId !== referral.teamId || tier !== referral.tier) filled = true;
    return { ...referral, teamId, tier };
  });
  const next = filled ? { ...data, referrals, teams } : data;
  if (filled) writeStored(next);
  return next;
}

function readStored(): PortalData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedPortal();
    const parsed: unknown = JSON.parse(raw);
    if (isPortalData(parsed))
      return withGranted(withPipeline(withSeats(parsed)));
  } catch {
    // Private mode and a corrupt value both fall back to the sample.
  }
  return seedPortal();
}

/** Sample partners are not granted. A partner staff added keeps access. */
function withGranted(data: PortalData): PortalData {
  const sampleIds = new Set(seedPortal().partners.map((partner) => partner.id));
  let filled = false;
  const partners = data.partners.map((partner) => {
    if (typeof partner.granted === 'boolean') return partner;
    filled = true;
    return { ...partner, granted: !sampleIds.has(partner.id) };
  });
  const next = filled ? { ...data, partners } : data;
  if (filled) writeStored(next);
  return next;
}

function writeStored(data: PortalData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // The in-memory copy still updates for this session.
  }
}

const portal = createRoot(() => {
  const [data, setData] = createSignal(readStored());
  const update = (recipe: (data: PortalData) => PortalData) => {
    const next = recipe(data());
    setData(next);
    writeStored(next);
  };
  return { data, update };
});

export function portalData(): PortalData {
  return portal.data();
}

export function addAcceptedPartner(input: {
  name: string;
  email: string;
  organization: string;
}): { ok: true; id: string } | { ok: false; error: 'invalid' | 'duplicate' } {
  const drafted = draftPartner(portal.data().partners, input);
  if (!drafted.ok) return drafted;
  const id = crypto.randomUUID();
  portal.update((data) => ({
    ...data,
    partners: [...data.partners, { ...drafted.partner, id }],
  }));
  return { ok: true, id };
}

export function setPartnerStatus(id: string, status: PartnerStatus) {
  portal.update((data) => ({
    ...data,
    partners: data.partners.map((partner) =>
      partner.id === id
        ? {
            ...partner,
            status,
            granted: status === 'accepted' ? true : partner.granted,
          }
        : partner
    ),
  }));
}

export function setTaxForm(id: string, taxForm: TaxForm) {
  portal.update((data) => ({
    ...data,
    partners: data.partners.map((partner) =>
      partner.id === id ? { ...partner, taxForm } : partner
    ),
  }));
}

export function setPaymentDetails(id: string, paymentDetails: boolean) {
  portal.update((data) => ({
    ...data,
    partners: data.partners.map((partner) =>
      partner.id === id ? { ...partner, paymentDetails } : partner
    ),
  }));
}

export function setDirectory(id: string, directory: boolean) {
  portal.update((data) => ({
    ...data,
    partners: data.partners.map((partner) =>
      partner.id === id ? { ...partner, directory } : partner
    ),
  }));
}

export function setTeamSeat(
  partnerId: string,
  input: { name: string; email: string } | null
): { ok: true } | { ok: false; error: 'invalid' | 'self' | 'unavailable' } {
  const partner = portal.data().partners.find((item) => item.id === partnerId);
  if (!partner) return { ok: false, error: 'unavailable' };
  const seat = input === null ? null : draftSeat(partner, input);
  if (seat && !seat.ok) return seat;
  portal.update((data) => ({
    ...data,
    partners: data.partners.map((item) =>
      item.id === partnerId
        ? { ...item, seat: seat === null ? null : seat.seat }
        : item
    ),
  }));
  return { ok: true };
}

export function addReferral(
  partnerId: string,
  input: { name: string; email: string; organization: string }
): { ok: true; id: string } | { ok: false; error: PortalError } {
  const data = portal.data();
  const partner = data.partners.find((item) => item.id === partnerId);
  if (!partner) return { ok: false, error: 'unavailable' };
  const drafted = draftReferral(partner, data.referrals, {
    ...input,
    claimedAt: new Date().toISOString(),
  });
  if (!drafted.ok) return drafted;
  const id = crypto.randomUUID();
  portal.update((current) => ({
    ...current,
    referrals: [...current.referrals, { ...drafted.referral, id }],
  }));
  return { ok: true, id };
}

export function reviewReferral(id: string, status: 'accepted' | 'rejected') {
  portal.update((data) => ({
    ...data,
    referrals: data.referrals.map((referral) =>
      referral.id === id && referral.status === 'submitted'
        ? { ...referral, status }
        : referral
    ),
  }));
}

export function recordReferralRevenue(id: string, cents: number | null) {
  portal.update((data) => ({
    ...data,
    referrals: data.referrals.map((referral) => {
      if (referral.id !== id) return referral;
      if (referral.status !== 'accepted' && referral.status !== 'paying') {
        return referral;
      }
      if (cents === null) {
        return { ...referral, status: 'accepted', firstYearRevenueCents: null };
      }
      return { ...referral, status: 'paying', firstYearRevenueCents: cents };
    }),
  }));
}

export function restoreSamplePartners() {
  const next = seedPortal();
  portal.update(() => next);
}

export function teamsFor(partnerId: string) {
  return portal
    .data()
    .teams.filter((team) => team.partnerId === partnerId)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function addCustomerTeam(
  partnerId: string,
  input: { name: string; memberCount: number }
): { ok: true; id: string } | { ok: false; error: 'invalid' } {
  const drafted = draftTeam(input);
  if (!drafted.ok) return drafted;
  const id = crypto.randomUUID();
  portal.update((data) => ({
    ...data,
    teams: [...data.teams, { ...drafted.team, id, partnerId }],
  }));
  return { ok: true, id };
}

export function setReferralPlacement(
  id: string,
  placement: {
    status: ReferralStatus;
    teamId: string | null;
    tier: PricingTier;
  }
) {
  portal.update((data) => ({
    ...data,
    referrals: data.referrals.map((referral) => {
      if (referral.id !== id) return referral;
      const teamOk =
        placement.teamId === null ||
        data.teams.some(
          (team) =>
            team.id === placement.teamId &&
            team.partnerId === referral.partnerId
        );
      return {
        ...referral,
        status: placement.status,
        teamId: teamOk ? placement.teamId : referral.teamId,
        tier: placement.tier,
        ineligibleReason:
          placement.status === 'ineligible' ? referral.ineligibleReason : null,
      };
    }),
  }));
}

export function referralsFor(partnerId: string): Referral[] {
  return portal
    .data()
    .referrals.filter((referral) => referral.partnerId === partnerId)
    .sort((a, b) => b.claimedAt.localeCompare(a.claimedAt));
}

export function payoutsFor(partnerId: string): Payout[] {
  return portal
    .data()
    .payouts.filter((payout) => payout.partnerId === partnerId)
    .sort((a, b) => b.year - a.year || b.quarter - a.quarter);
}
