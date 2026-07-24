import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useEmail } from '@core/context/user';
import { idToDisplayName } from '@core/user/util';
import CheckIcon from '@phosphor/check.svg';
import Plus from '@phosphor/plus.svg';
import { useContacts } from '@queries/contacts/contacts';
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
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Index,
  Show,
} from 'solid-js';
import {
  ContinueButton,
  deriveTeamName,
  emailDomain,
  FormInput,
  isPlausibleEmail,
  SkipButton,
} from './shared';

/** Set up your team: already a member → confirmation, pending invites →
 * join, otherwise create (with domain-derived prefill + suggestions). */
export function TeamStep(props: {
  onContinue: () => void;
  onSkip: () => void;
}) {
  const analytics = useAnalytics();
  const teamsQuery = useUserTeamsQuery();
  const invitesQuery = useUserInvitesQuery();

  const team = createMemo(() => teamsQuery.data?.[0]);
  const invites = createMemo(() => invitesQuery.data?.invites ?? []);

  // One-shot on the FIRST resolved teams payload, so a create/join later
  // in this step doesn't also read as auto-joined.
  let membershipReported = false;
  createEffect(() => {
    if (membershipReported || teamsQuery.data === undefined) return;
    membershipReported = true;
    if (teamsQuery.data.length > 0) {
      analytics.track('onboarding_v4_team', { action: 'already_on_team' });
    }
  });

  return (
    <Show
      when={!team()}
      fallback={
        <OnTeamPanel name={team()?.name} onContinue={props.onContinue} />
      }
    >
      <Show
        when={invites().length === 0}
        fallback={<InvitesPanel invites={invites()} onSkip={props.onSkip} />}
      >
        <CreateTeamForm onContinue={props.onContinue} onSkip={props.onSkip} />
      </Show>
    </Show>
  );
}

/** Already on a team — auto-joined by domain, or just created/joined here. */
function OnTeamPanel(props: { name?: string; onContinue: () => void }) {
  return (
    <div class="flex flex-col gap-3">
      <div class="flex flex-col items-center gap-2 py-4 text-center">
        <span class="flex size-10 items-center justify-center rounded-full bg-success/10 text-success">
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

const INITIAL_INVITE_SLOTS = ['', ''];
const SUGGESTION_CAP = 6;

/** Create a team: pre-derived name + same-domain invite suggestions when the
 * user has a custom domain; the plain form otherwise. */
function CreateTeamForm(props: { onContinue: () => void; onSkip: () => void }) {
  const analytics = useAnalytics();
  const email = useEmail();
  const contacts = useContacts();
  const createTeam = useCreateTeamWithInvitesMutation();
  const onboardingQuery = useOnboardingQuery();

  // Server-judged with the same list the teams service uses for
  // auto-join/claiming, so we never suggest a team the server would refuse.
  const customDomain = () =>
    onboardingQuery.data?.suggested_team_domain ?? undefined;

  const [name, setName] = createSignal('');
  const [nameTouched, setNameTouched] = createSignal(false);
  // Prefill once the suggestion arrives, never over a typed name.
  createEffect(() => {
    const domain = customDomain();
    if (domain && !nameTouched()) setName(deriveTeamName(domain));
  });
  const [inviteSlots, setInviteSlots] = createSignal<string[]>([
    ...INITIAL_INVITE_SLOTS,
  ]);

  const validInvites = () =>
    [...new Set(inviteSlots().map((value) => value.trim()))].filter(
      (value) => isPlausibleEmail(value) && value !== email()
    );

  const suggestions = createMemo(() => {
    const suffix = customDomain();
    if (!suffix) return [];
    const own = email();
    const taken = new Set(inviteSlots().map((value) => value.trim()));
    return contacts()
      .filter(
        (contact) =>
          contact.email !== own &&
          emailDomain(contact.email) === suffix &&
          !taken.has(contact.email)
      )
      .slice(0, SUGGESTION_CAP);
  });

  const addInvite = (address: string) => {
    setInviteSlots((slots) => {
      const empty = slots.findIndex((value) => value.trim() === '');
      if (empty === -1) return [...slots, address];
      return slots.map((value, i) => (i === empty ? address : value));
    });
  };

  const create = async () => {
    if (createTeam.isPending || name().trim().length === 0) return;
    // The mutation owns its toasts; stay put (form intact) on failure.
    const invitesSent = validInvites().length;
    try {
      await createTeam.mutateAsync({
        name: name().trim(),
        invites: validInvites().map((address) => ({ email: address })),
      });
    } catch {
      return;
    }
    analytics.track('onboarding_v4_team', {
      action: 'created',
      invites_sent: invitesSent,
      used_domain_suggestion: customDomain() !== undefined,
    });
    props.onContinue();
  };

  return (
    <div class="flex flex-col gap-3">
      <FormInput
        id="team-name"
        placeholder="Team name"
        value={name()}
        autoFocus={!customDomain()}
        onInput={(value) => {
          setNameTouched(true);
          setName(value);
        }}
      />

      {/* Index, not For: slots are edited strings, and For keys by value —
          each keystroke would recreate the input node and drop focus. */}
      <Index each={inviteSlots()}>
        {(slot, i) => (
          <FormInput
            id={`invite-${i}`}
            type="email"
            placeholder="teammate@company.com"
            value={slot()}
            onInput={(value) =>
              setInviteSlots((slots) =>
                slots.map((v, j) => (j === i ? value : v))
              )
            }
          />
        )}
      </Index>

      <Button
        variant="ghost"
        size="sm"
        class="self-center text-ink-muted"
        onClick={() => setInviteSlots((slots) => [...slots, ''])}
      >
        <Plus class="size-4" />
        Add another teammate
      </Button>

      <Show when={suggestions().length > 0}>
        <div class="flex flex-col gap-1.5">
          <p class="text-xs text-ink-muted">
            From your contacts at {customDomain()}:
          </p>
          <div class="flex flex-wrap gap-1.5">
            <For each={suggestions()}>
              {(contact) => (
                <button
                  type="button"
                  title={`Invite ${contact.email}`}
                  onClick={() => addInvite(contact.email)}
                  class="inline-flex h-7 max-w-72 items-center gap-1.5 rounded-full border border-ink/10 bg-surface px-2.5 text-xs text-ink transition-colors hover:border-ink/20"
                >
                  <Plus class="size-3 shrink-0 text-ink-extra-muted" />
                  <span class="min-w-0 truncate">{contact.email}</span>
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>

      <ContinueButton
        label={
          validInvites().length > 0
            ? `Create team & invite ${validInvites().length}`
            : 'Create team'
        }
        disabled={name().trim().length === 0 || createTeam.isPending}
        onClick={() => void create()}
      />
      <SkipButton onClick={props.onSkip} />
    </div>
  );
}
