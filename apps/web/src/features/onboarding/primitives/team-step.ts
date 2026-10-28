import { createEffect, createSignal } from 'solid-js';
import type {
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
  /** Already a member: auto-joined by domain, or just created/joined here. */
  | { t: 'on-team'; name: string }
  | { t: 'invites'; invites: readonly TeamInvite[] }
  | { t: 'create' };

export function createTeamStep(
  context: Pick<OnboardingContext, 'joinTeam' | 'track'>,
  directory: TeamDirectorySource
) {
  const [joining, setJoining] = createSignal(false);

  const state = (): TeamStepState => {
    const teams = directory.teams();
    const invites = directory.invites();
    if (teams.t === 'error' || invites.t === 'error') return { t: 'error' };
    if (teams.t === 'loading' || invites.t === 'loading')
      return { t: 'loading' };
    const team = teams.value[0];
    if (team) return { t: 'on-team', name: team.name };
    if (invites.value.length > 0)
      return { t: 'invites', invites: invites.value };
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

  const join = async (inviteId: string) => {
    if (joining()) return;
    setJoining(true);
    try {
      await context.joinTeam(inviteId);
      context.track('onboarding_v4_team', { action: 'joined_invite' });
    } catch {
      // The capability reports its own failure; the invite stays offered.
    } finally {
      setJoining(false);
    }
  };

  return { state, joining, join, retry: directory.retry };
}

/** The create form's prefill, once contacts and the domain suggestion settle. */
export type TeamFormSeed = { domain: string | undefined; prefilled: string[] };

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
    prefilled: prefillableTeammates({
      contacts: input.contacts.t === 'ready' ? input.contacts.value : [],
      domain,
      ownEmail: input.ownEmail,
    }),
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
  options: { ownEmail: string | undefined; onCreated: () => void }
) {
  const [name, setName] = createSignal(
    seed.domain ? deriveTeamName(seed.domain) : ''
  );
  const [slots, setSlots] = createSignal<string[]>(
    seed.prefilled.length > 0 ? [...seed.prefilled, ''] : ['', '']
  );
  const [pending, setPending] = createSignal(false);

  const invites = () => validInviteEmails(slots(), options.ownEmail);
  const canCreate = () => name().trim().length > 0 && !pending();

  const create = async () => {
    if (!canCreate()) return;
    const sent = invites();
    setPending(true);
    try {
      await context.createTeam({ name: name().trim(), invites: sent });
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
    });
    options.onCreated();
  };

  return {
    name,
    setName,
    slots,
    setSlot: (index: number, value: string) =>
      setSlots((current) =>
        current.map((slot, i) => (i === index ? value : slot))
      ),
    removeSlot: (index: number) =>
      setSlots((current) => removeInviteSlot(current, index)),
    addSlot: () => setSlots((current) => [...current, '']),
    invites,
    pending,
    canCreate,
    suggested: seed.prefilled.length > 0,
    create,
  };
}
