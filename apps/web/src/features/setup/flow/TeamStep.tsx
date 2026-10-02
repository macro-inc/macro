import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useEmail } from '@core/context/user';
import { idToDisplayName } from '@core/user/util';
import CheckIcon from '@phosphor/check.svg';
import { useContacts, useContactsQuery } from '@queries/contacts/contacts';
import { useOnboardingQuery } from '@queries/onboarding';
import {
  useJoinTeamMutation,
  useUserInvitesQuery,
} from '@queries/team/invitations';
import {
  useCreateTeamWithInvitesMutation,
  useUserTeamsQuery,
} from '@queries/team/teams';
import type { TeamInviteDetails } from '@service-auth/generated/schemas/teamInviteDetails';
import { Button } from '@ui';
import { createEffect, createSignal, For, Show } from 'solid-js';
import { ContinueButton, SkipButton } from '../components/controls';
import { TeamSetup, TeamSetupFields } from '../components/TeamSetup';
import { deriveTeamName } from './shared';
import {
  prefillableTeammates,
  removeInviteSlot,
  validInviteEmails,
} from './teamInvites';

/** Set up your team: already a member → confirmation, pending invites →
 * join, otherwise create (with a domain-derived name and same-domain
 * teammates pre-added to the invite list). */
export function TeamStep(props: {
  onContinue: () => void;
  onSkip: () => void;
}) {
  const analytics = useAnalytics();
  const teamsQuery = useUserTeamsQuery();
  const invitesQuery = useUserInvitesQuery();

  const team = () => (teamsQuery.isSuccess ? teamsQuery.data?.[0] : undefined);
  const invites = () =>
    invitesQuery.isSuccess ? (invitesQuery.data?.invites ?? []) : [];

  // One-shot on the FIRST resolved teams payload, so a create/join later
  // in this step doesn't also read as auto-joined.
  let membershipReported = false;
  createEffect(() => {
    if (membershipReported || !teamsQuery.isSuccess) return;
    membershipReported = true;
    if (teamsQuery.data.length > 0) {
      analytics.track('onboarding_v4_team', { action: 'already_on_team' });
    }
  });

  return (
    <TeamSetup>
      <Show when={teamsQuery.isError || invitesQuery.isError}>
        <p role="alert" class="text-center text-sm text-ink-muted">
          Couldn't load your team.{' '}
          <button
            type="button"
            class="underline"
            onClick={() => {
              void teamsQuery.refetch();
              void invitesQuery.refetch();
            }}
          >
            Try again
          </button>
        </p>
      </Show>
      <Show
        when={teamsQuery.isSuccess && invitesQuery.isSuccess}
        fallback={
          <Show when={!teamsQuery.isError && !invitesQuery.isError}>
            <p role="status" class="text-center text-sm text-ink-muted">
              Loading your team…
            </p>
          </Show>
        }
      >
        <Show
          when={!team()}
          fallback={
            <OnTeamPanel name={team()?.name} onContinue={props.onContinue} />
          }
        >
          <Show
            when={invites().length === 0}
            fallback={
              <InvitesPanel invites={invites()} onSkip={props.onSkip} />
            }
          >
            <CreateTeamForm
              onContinue={props.onContinue}
              onSkip={props.onSkip}
            />
          </Show>
        </Show>
      </Show>
    </TeamSetup>
  );
}

/** Already on a team — auto-joined by domain, or just created/joined here. */
function OnTeamPanel(props: { name?: string; onContinue: () => void }) {
  return (
    <div class="flex flex-col gap-3">
      <div class="flex flex-col items-center gap-2 py-4 text-center">
        <span class="flex size-10 items-center justify-center rounded-full bg-success-bg text-success">
          <CheckIcon class="size-5" />
        </span>
        <p class="text-sm font-medium text-ink">
          You're on {props.name ?? 'your team'}
        </p>
        {/* Copy must stay true for auto-join, invite-accept, and the
            optimistic mid-create flash alike. */}
        <p class="max-w-xs text-xs text-ink-muted leading-snug">
          Your team is set up — everything your teammates bring into Macro is
          shared with you.
        </p>
      </div>
      <ContinueButton onClick={props.onContinue} />
    </div>
  );
}

/** Pending team invites — join one and move on. */
function InvitesPanel(props: {
  invites: TeamInviteDetails[];
  onSkip: () => void;
}) {
  const analytics = useAnalytics();
  const joinTeam = useJoinTeamMutation({
    onSuccess: () => {
      analytics.track('onboarding_v4_team', { action: 'joined_invite' });
    },
  });

  return (
    <div class="flex flex-col gap-3">
      <For each={props.invites}>
        {(invite) => (
          <div class="flex items-center gap-2.5 rounded-lg border border-edge bg-surface px-4 py-3 text-sm">
            <span class="min-w-0 truncate text-ink">
              {idToDisplayName(invite.invited_by)} invited you to their team
            </span>
            <Button
              variant="cta"
              size="sm"
              class="ml-auto shrink-0"
              disabled={joinTeam.isPending}
              onClick={() => joinTeam.mutate({ teamInviteId: invite.id })}
            >
              Join
            </Button>
          </div>
        )}
      </For>
      <SkipButton onClick={props.onSkip} />
    </div>
  );
}

/** Create a team: same-domain teammates arrive pre-added to the invite list
 * (remove to opt them out) when the user has a custom domain; the plain form
 * otherwise. Waits for contacts and the domain suggestion so the form mounts
 * once, fully formed — nothing rewrites the user's rows afterwards. */
function CreateTeamForm(props: { onContinue: () => void; onSkip: () => void }) {
  const email = useEmail();
  const contacts = useContacts();
  const contactsQuery = useContactsQuery();
  const onboardingQuery = useOnboardingQuery();

  // Server-judged with the same list the teams service uses for
  // auto-join/claiming, so we never suggest a team the server would refuse.
  const customDomain = () =>
    onboardingQuery.isSuccess
      ? (onboardingQuery.data?.suggested_team_domain ?? undefined)
      : undefined;

  // Settled, not succeeded: an errored query opens the plain form.
  const ready = () =>
    !contactsQuery.isPending && !onboardingQuery.isPlaceholderData;

  return (
    <Show
      when={ready()}
      fallback={
        <p role="status" class="text-center text-sm text-ink-muted">
          Finding your teammates…
        </p>
      }
    >
      <TeamForm
        domain={customDomain()}
        prefilledTeammates={prefillableTeammates({
          contacts: contacts(),
          domain: customDomain(),
          ownEmail: email(),
        })}
        onContinue={props.onContinue}
        onSkip={props.onSkip}
      />
    </Show>
  );
}

/** The create-team form proper — mounted with its prefill inputs resolved,
 * so the name and invite slots initialize once and stay user-owned. */
function TeamForm(props: {
  domain: string | undefined;
  prefilledTeammates: string[];
  onContinue: () => void;
  onSkip: () => void;
}) {
  const analytics = useAnalytics();
  const email = useEmail();
  const createTeam = useCreateTeamWithInvitesMutation();

  const [name, setName] = createSignal(
    props.domain ? deriveTeamName(props.domain) : ''
  );
  // Same-domain teammates are pre-added rather than offered: the default is
  // "invite them", and removing a row is how you opt one out.
  const prefilled = props.prefilledTeammates;
  const [inviteSlots, setInviteSlots] = createSignal<string[]>(
    prefilled.length > 0 ? [...prefilled, ''] : ['', '']
  );

  const validInvites = () => validInviteEmails(inviteSlots(), email());

  const create = async () => {
    if (createTeam.isPending || name().trim().length === 0) return;
    // The mutation owns its toasts; stay put (form intact) on failure.
    const invites = validInvites();
    try {
      await createTeam.mutateAsync({
        name: name().trim(),
        invites: invites.map((address) => ({ email: address })),
      });
    } catch {
      return;
    }
    const kept = new Set(invites);
    analytics.track('onboarding_v4_team', {
      action: 'created',
      invites_sent: invites.length,
      invites_prefilled: prefilled.length,
      invites_removed: prefilled.filter((address) => !kept.has(address)).length,
      used_domain_suggestion: props.domain !== undefined,
    });
    props.onContinue();
  };

  return (
    <div class="flex flex-col gap-3">
      <TeamSetupFields
        id="team"
        name={name()}
        emails={inviteSlots()}
        disabled={createTeam.isPending}
        suggested={prefilled.length > 0}
        onNameChange={setName}
        onEmailChange={(index, value) =>
          setInviteSlots((slots) =>
            slots.map((slot, i) => (i === index ? value : slot))
          )
        }
        onRemoveEmail={(index) =>
          setInviteSlots((slots) => removeInviteSlot(slots, index))
        }
        onAddEmail={() => setInviteSlots((slots) => [...slots, ''])}
      />
      <ContinueButton
        label={
          createTeam.isPending
            ? 'Creating workspace…'
            : validInvites().length > 0
              ? `Create team & invite ${validInvites().length}`
              : 'Create team'
        }
        disabled={name().trim().length === 0 || createTeam.isPending}
        onClick={() => void create()}
      />
      <SkipButton disabled={createTeam.isPending} onClick={props.onSkip} />
    </div>
  );
}
