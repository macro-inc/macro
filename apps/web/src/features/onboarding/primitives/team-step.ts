import { createEffect, createSignal } from 'solid-js';
import type {
  DomainTeam,
  Loadable,
  OnboardingContext,
  OnboardingRecord,
  TeamDirectorySource,
  TeamInvite,
} from '../context/onboarding-context';
import {
  deriveTeamName,
  prefillableTeammates,
  removeInviteSlot,
  validInviteEmails,
} from '../core/team';

/** What the team step offers, in priority order. */
export type TeamStepState =
  | { t: 'loading' }
  | { t: 'error' }
  /** Already a member: joined through an invite link, or just created or
   * joined here. */
  | { t: 'on-team'; name: string }
  /** Teams the viewer may join: email invites and their domain team. */
  | {
      t: 'invites';
      invites: readonly TeamInvite[];
      domainTeam: DomainTeam | null;
    }
  | { t: 'create' };

export function createTeamStep(
  context: Pick<OnboardingContext, 'joinTeam' | 'joinDomainTeam' | 'track'>,
  directory: TeamDirectorySource
) {
  const [joining, setJoining] = createSignal(false);

  const state = (): TeamStepState => {
    const teams = directory.teams();
    const invites = directory.invites();
    const domainTeam = directory.domainTeam();
    if (
      teams.t === 'error' ||
      invites.t === 'error' ||
      domainTeam.t === 'error'
    )
      return { t: 'error' };
    if (
      teams.t === 'loading' ||
      invites.t === 'loading' ||
      domainTeam.t === 'loading'
    )
      return { t: 'loading' };
    const team = teams.value[0];
    if (team) return { t: 'on-team', name: team.name };
    if (invites.value.length > 0 || domainTeam.value)
      return {
        t: 'invites',
        invites: invites.value,
        domainTeam: domainTeam.value,
      };
    return { t: 'create' };
  };

  // One-shot on the FIRST resolved teams payload, so a create/join later in
  // this step doesn't also read as auto-joined.
  let membershipReported = false;
  createEffect(() => {
    const teams = directory.teams();
    if (membershipReported || teams.t !== 'ready') return;
    membershipReported = true;
    if (teams.value.length > 0)
      context.track('onboarding_v4_team', { action: 'already_on_team' });
  });

  const runJoin = async (
    joinTeam: () => Promise<void>,
    action: 'joined_invite' | 'joined_domain_team'
  ) => {
    if (joining()) return;
    setJoining(true);
    try {
      await joinTeam();
      context.track('onboarding_v4_team', { action });
    } catch {
      // The capability reports its own failure; the team stays offered.
    } finally {
      setJoining(false);
    }
  };
  const join = (inviteId: string) =>
    runJoin(() => context.joinTeam(inviteId), 'joined_invite');
  const joinDomainTeam = () =>
    runJoin(() => context.joinDomainTeam(), 'joined_domain_team');

  return { state, joining, join, joinDomainTeam, retry: directory.retry };
}

/** The create form's prefill, once contacts and the domain suggestion settle. */
export type TeamFormSeed = {
  domain: string | undefined;
  /** The record loaded without a work domain: show referrals, not a team form. */
  personal: boolean;
  prefilled: string[];
};

export function teamFormSeed(input: {
  record: Loadable<OnboardingRecord>;
  contacts: Loadable<readonly string[]>;
  ownEmail: string | undefined;
}): TeamFormSeed | undefined {
  // Settled, not succeeded: an errored source opens the plain form.
  if (input.record.t === 'loading' || input.contacts.t === 'loading') return;
  const domain =
    input.record.t === 'ready'
      ? input.record.value.suggestedTeamDomain
      : undefined;
  return {
    domain,
    personal: input.record.t === 'ready' && !domain,
    prefilled: prefillableTeammates({
      contacts: input.contacts.t === 'ready' ? input.contacts.value : [],
      domain,
      ownEmail: input.ownEmail,
    }),
  };
}

/** Invite rows a user edits; at least one row always remains. */
function createInviteSlots(initial: string[]) {
  const [slots, setSlots] = createSignal<string[]>(initial);
  return {
    slots,
    setSlot: (index: number, value: string) =>
      setSlots((current) =>
        current.map((slot, i) => (i === index ? value : slot))
      ),
    removeSlot: (index: number) =>
      setSlots((current) => removeInviteSlot(current, index)),
    addSlot: () => setSlots((current) => [...current, '']),
  };
}

/**
 * The create-team form, initialized once from its seed so the name and invite
 * rows stay user-owned. Same-domain teammates are pre-added rather than
 * offered: removing a row is how the user opts one out.
 */
export function createTeamForm(
  context: Pick<OnboardingContext, 'createTeam' | 'track'>,
  seed: TeamFormSeed,
  options: {
    ownEmail: string | undefined;
    /** Called once the team exists, with the addresses it emailed. */
    onCreated?: (sent: readonly string[]) => void;
  }
) {
  const [name, setName] = createSignal(
    seed.domain ? deriveTeamName(seed.domain) : ''
  );
  const rows = createInviteSlots(
    seed.prefilled.length > 0 ? [...seed.prefilled, ''] : ['', '']
  );
  const [pending, setPending] = createSignal(false);
  // Only a work domain can be joined by domain; on by default.
  const [allowDomainJoin, setAllowDomainJoin] = createSignal(true);
  const domainJoin = () => seed.domain !== undefined && allowDomainJoin();

  const invites = () => validInviteEmails(rows.slots(), options.ownEmail);
  const canCreate = () => name().trim().length > 0 && !pending();

  const create = async () => {
    if (!canCreate()) return;
    const sent = invites();
    setPending(true);
    try {
      await context.createTeam({
        name: name().trim(),
        invites: sent,
        allowDomainJoin: domainJoin(),
      });
    } catch {
      // The capability reports its own failure; keep the form intact.
      return;
    } finally {
      setPending(false);
    }
    const kept = new Set(sent);
    context.track('onboarding_v4_team', {
      action: 'created',
      invites_sent: sent.length,
      invites_prefilled: seed.prefilled.length,
      invites_removed: seed.prefilled.filter((address) => !kept.has(address))
        .length,
      used_domain_suggestion: seed.domain !== undefined,
      allow_domain_join: domainJoin(),
    });
    options.onCreated?.(sent);
  };

  return {
    name,
    setName,
    ...rows,
    invites,
    pending,
    canCreate,
    /** The work domain colleagues can join by, when there is one. */
    domain: seed.domain,
    allowDomainJoin,
    setAllowDomainJoin,
    create,
  };
}

/**
 * Referral invites for a personal address: no team is created; each person
 * who signs up earns the inviter AI credit.
 */
export function createReferralForm(
  context: Pick<
    OnboardingContext,
    'sendReferralInvites' | 'copyReferralLink' | 'track'
  >,
  options: { ownEmail: string | undefined; onSent: () => void }
) {
  const rows = createInviteSlots(['', '']);
  const [sending, setSending] = createSignal(false);
  const [copying, setCopying] = createSignal(false);
  const invites = () => validInviteEmails(rows.slots(), options.ownEmail);

  const send = async () => {
    const sent = invites();
    if (sending() || sent.length === 0) return;
    setSending(true);
    try {
      await context.sendReferralInvites(sent);
    } catch {
      // The capability reports its own failure; keep the addresses.
      return;
    } finally {
      setSending(false);
    }
    context.track('onboarding_v4_team', {
      action: 'referrals_sent',
      invites_sent: sent.length,
    });
    options.onSent();
  };

  const copyLink = async () => {
    if (copying()) return;
    setCopying(true);
    try {
      await context.copyReferralLink();
      context.track('onboarding_v4_team', { action: 'referral_link_copied' });
    } catch {
      // The capability reports its own failure.
    } finally {
      setCopying(false);
    }
  };

  return { ...rows, invites, sending, send, copying, copyLink };
}

/** Copies the team's invite link from the on-team confirmation. */
export function createTeamInviteLinkCopy(
  context: Pick<OnboardingContext, 'copyTeamInviteLink' | 'track'>
) {
  const [copying, setCopying] = createSignal(false);
  const copy = async () => {
    if (copying()) return;
    setCopying(true);
    try {
      await context.copyTeamInviteLink();
      context.track('onboarding_v4_team', { action: 'invite_link_copied' });
    } catch {
      // The capability reports its own failure.
    } finally {
      setCopying(false);
    }
  };
  return { copying, copy };
}
