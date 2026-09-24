import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useEmail } from '@core/context/user';
import { idToDisplayName } from '@core/user/util';
import CheckIcon from '@phosphor/check.svg';
import UsersIcon from '@phosphor/users.svg';
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
import { TeamSetupFields } from '../components/TeamSetup';
import { ContinueButton, deriveTeamName, isPlausibleEmail } from './shared';
import {
  PREFILL_CAP,
  prefillableTeammates,
  removeInviteSlot,
  validInviteEmails,
} from './teamInvites';

/** Set up your team: already a member → confirmation, pending invites →
 * join, otherwise create (with a domain-derived name and same-domain
 * teammates pre-added to the invite list). */
export function TeamStep(props: { onContinue: () => void }) {
  const analytics = useAnalytics();
  const teamsQuery = useUserTeamsQuery();
  const invitesQuery = useUserInvitesQuery();

  const team = () => (teamsQuery.isSuccess ? teamsQuery.data?.[0] : undefined);
  const invites = () =>
    invitesQuery.isSuccess ? (invitesQuery.data?.invites ?? []) : [];
  const pending = () =>
    teamsQuery.isPending || (!team() && invitesQuery.isPending);
  const failed = () => teamsQuery.isError || (!team() && invitesQuery.isError);

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
    <Show when={!pending()} fallback={<TeamLoading />}>
      <Show
        when={!failed()}
        fallback={
          <div class="flex flex-col gap-5">
            <div role="alert" class="py-6 text-center">
              <p class="text-base font-medium text-ink">
                We couldn’t load your team.
              </p>
              <p class="mt-2 text-sm leading-6 text-ink-muted">
                Try again to finish setting up your workspace.
              </p>
              <Button
                variant="outline"
                class="mt-5"
                onClick={() => {
                  void teamsQuery.refetch();
                  void invitesQuery.refetch();
                }}
              >
                Try again
              </Button>
            </div>
          </div>
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
              <InvitesPanel invites={invites()} onContinue={props.onContinue} />
            }
          >
            <CreateTeamForm onContinue={props.onContinue} />
          </Show>
        </Show>
      </Show>
    </Show>
  );
}

/** Already on a team — auto-joined by domain, or just created/joined here. */
function OnTeamPanel(props: { name?: string; onContinue: () => void }) {
  return (
    <div class="flex flex-col gap-6">
      <div class="flex flex-col items-center py-4 text-center">
        <span class="mb-5 flex size-12 items-center justify-center rounded-full bg-success-bg text-success">
          <CheckIcon class="size-6" />
        </span>
        <p class="text-xl font-medium text-ink">
          You're on {props.name ?? 'your team'}
        </p>
        <p class="mt-3 max-w-sm text-sm leading-6 text-ink-muted">
          Your shared workspace is ready. Bring your team’s documents,
          conversations, and agents together.
        </p>
      </div>
      <ContinueButton onClick={props.onContinue} />
    </div>
  );
}

function TeamLoading() {
  return (
    <div class="flex flex-col gap-5">
      <div role="status" class="py-6 text-center">
        <UsersIcon
          class="mx-auto mb-4 size-8 text-ink-muted"
          aria-hidden="true"
        />
        <p class="text-base text-ink">Getting your team ready…</p>
        <p class="mt-2 text-sm leading-6 text-ink-muted">
          Checking your teams and invitations.
        </p>
      </div>
    </div>
  );
}

/** Pending team invites — join one and move on. */
function InvitesPanel(props: {
  invites: TeamInviteDetails[];
  onContinue: () => void;
}) {
  const analytics = useAnalytics();
  const joinTeam = useJoinTeamMutation({
    onSuccess: () => {
      analytics.track('onboarding_v4_team', { action: 'joined_invite' });
      props.onContinue();
    },
  });

  return (
    <div class="flex flex-col gap-5">
      <p class="text-sm leading-6 text-ink-muted">
        Your team has saved you a place. Accept an invitation to join their
        workspace.
      </p>
      <For each={props.invites}>
        {(invite) => (
          <div class="glass flex items-center gap-4 rounded-2xl bg-ink/3 p-5">
            <span class="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-edge-muted bg-ink/5 text-ink-muted">
              <UsersIcon class="size-5" aria-hidden="true" />
            </span>
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium leading-6 text-ink">
                {idToDisplayName(invite.invited_by)} invited you
              </p>
              <p class="mt-1 break-all text-xs leading-5 text-ink-muted">
                Invitation for {invite.email}
              </p>
            </div>
            <Button
              variant="cta"
              size="sm"
              class="shrink-0"
              disabled={joinTeam.isPending}
              onClick={() => joinTeam.mutate({ teamInviteId: invite.id })}
            >
              {joinTeam.isPending &&
              joinTeam.variables?.teamInviteId === invite.id
                ? 'Joining…'
                : 'Join team'}
            </Button>
          </div>
        )}
      </For>
      <Show when={joinTeam.isError}>
        <p role="alert" class="text-sm leading-6 text-failure">
          We couldn’t accept this invitation. Please try again.
        </p>
      </Show>
    </div>
  );
}

/** Create a team: same-domain teammates arrive pre-added to the invite list
 * (remove to opt them out) when the user has a custom domain; the plain form
 * otherwise. Waits for contacts and the domain suggestion so the form mounts
 * once, fully formed — nothing rewrites the user's rows afterwards. */
function CreateTeamForm(props: { onContinue: () => void }) {
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
    !contactsQuery.isPending &&
    !onboardingQuery.isPending &&
    !onboardingQuery.isPlaceholderData;

  return (
    <Show when={ready()} fallback={<TeamLoading />}>
      <TeamForm
        domain={customDomain()}
        prefilledTeammates={prefillableTeammates({
          contacts: contacts(),
          domain: customDomain(),
          ownEmail: email(),
        })}
        onContinue={props.onContinue}
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
}) {
  const analytics = useAnalytics();
  const email = useEmail();
  const createTeam = useCreateTeamWithInvitesMutation();

  const draftKey = `onboarding-team-draft:${email()}`;
  const saved = (() => {
    try {
      const value = JSON.parse(sessionStorage.getItem(draftKey) ?? 'null');
      if (
        typeof value?.name === 'string' &&
        Array.isArray(value?.slots) &&
        value.slots.every((slot: unknown) => typeof slot === 'string')
      )
        return {
          name: value.name as string,
          // Honor opting out in an older draft after removing the checkbox.
          slots: value.inviteTeam === false ? [''] : (value.slots as string[]),
        };
    } catch {
      /* A blocked or old record leaves the default form usable. */
    }
    return undefined;
  })();
  const [name, setName] = createSignal(
    saved?.name ?? (props.domain ? deriveTeamName(props.domain) : '')
  );
  // Same-domain teammates are pre-added rather than offered: the default is
  // "invite them", and removing a row is how you opt one out.
  const prefilled = props.prefilledTeammates;
  const [inviteSlots, setInviteSlots] = createSignal<string[]>(
    saved?.slots ?? (prefilled.length > 0 ? [...prefilled, ''] : ['', ''])
  );
  // Persist drafts per account before following a marketing link or refreshing.
  createEffect(() => {
    const draft = {
      name: name(),
      slots: inviteSlots(),
    };
    try {
      sessionStorage.setItem(draftKey, JSON.stringify(draft));
    } catch {
      /* Storage can be disabled. */
    }
  });

  const validInvites = () => validInviteEmails(inviteSlots(), email());
  const hasInvalidInvites = () =>
    inviteSlots().some(
      (value) => value.trim() !== '' && !isPlausibleEmail(value)
    );
  const tooManyInvites = () => validInvites().length > PREFILL_CAP;

  const create = async () => {
    if (
      createTeam.isPending ||
      name().trim().length === 0 ||
      tooManyInvites() ||
      hasInvalidInvites()
    )
      return;
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
    try {
      sessionStorage.removeItem(draftKey);
    } catch {
      /* Storage can be disabled. */
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
    <div class="flex flex-col gap-5">
      <TeamSetupFields
        id="team"
        name={name()}
        emails={inviteSlots()}
        disabled={createTeam.isPending}
        suggested={prefilled.length > 0}
        onNameChange={setName}
        onEmailChange={(index, value) =>
          setInviteSlots((slots) =>
            slots.map((entry, i) => (i === index ? value : entry))
          )
        }
        onRemoveEmail={(index) =>
          setInviteSlots((slots) => removeInviteSlot(slots, index))
        }
        onAddEmail={() => setInviteSlots((slots) => [...slots, ''])}
      >
        <Show when={hasInvalidInvites()}>
          <p role="alert" class="text-sm leading-6 text-failure">
            Enter a valid email address for each teammate, or remove that row.
          </p>
        </Show>
        <Show when={tooManyInvites()}>
          <p role="alert" class="text-sm leading-6 text-failure">
            Choose up to {PREFILL_CAP} teammates to invite during setup.
          </p>
        </Show>
        <p class="text-xs leading-5 text-ink-muted">
          {validInvites().length > 0
            ? 'Invitations are sent only when you choose “Create team & invite” below.'
            : 'Start on your own, then invite people whenever you’re ready.'}
        </p>
      </TeamSetupFields>
      <Show when={createTeam.isError}>
        <p role="alert" class="text-sm leading-6 text-failure">
          We couldn’t finish creating your team. Your details are saved here;
          please try again.
        </p>
      </Show>
      <ContinueButton
        label={
          createTeam.isPending
            ? 'Creating your team…'
            : validInvites().length > 0
              ? `Create team & invite ${validInvites().length}`
              : 'Create team'
        }
        disabled={
          name().trim().length === 0 ||
          createTeam.isPending ||
          tooManyInvites() ||
          hasInvalidInvites()
        }
        onClick={() => void create()}
      />
    </div>
  );
}
