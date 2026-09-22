import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useEmail } from '@core/context/user';
import { idToDisplayName } from '@core/user/util';
import CheckIcon from '@phosphor/check.svg';
import Plus from '@phosphor/plus.svg';
import XIcon from '@phosphor/x.svg';
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
  FormInput,
  isPlausibleEmail,
  SkipButton,
} from './shared';
import {
  PREFILL_CAP,
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
        <span class="flex size-10 items-center justify-center rounded-full bg-success-bg text-success">
          <CheckIcon class="size-5" />
        </span>
        <p class="text-sm font-medium text-ink">
          You're on {props.name ?? 'your team'}
        </p>

        <p class="max-w-xs text-xs text-ink-muted leading-snug">
          Your team is set up. Share documents, channels, and context when
          you’re ready.
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
    onboardingQuery.data?.suggested_team_domain ?? undefined;

  // Settled, not succeeded: an errored query opens the plain form.
  const ready = () =>
    !contactsQuery.isPending && !onboardingQuery.isPlaceholderData;

  return (
    <Show when={ready()}>
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

  const draftKey = `onboarding-team-draft:${email()}`;
  const saved = (() => {
    try {
      const value = JSON.parse(sessionStorage.getItem(draftKey) ?? 'null');
      if (
        typeof value?.name === 'string' &&
        typeof value?.inviteTeam === 'boolean' &&
        Array.isArray(value?.slots) &&
        value.slots.every((slot: unknown) => typeof slot === 'string')
      )
        return value as { name: string; inviteTeam: boolean; slots: string[] };
    } catch {
      /* A blocked or old record leaves the default form usable. */
    }
    return undefined;
  })();
  const [inviteTeam, setInviteTeam] = createSignal(saved?.inviteTeam ?? true);
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
      inviteTeam: inviteTeam(),
      slots: inviteSlots(),
    };
    try {
      sessionStorage.setItem(draftKey, JSON.stringify(draft));
    } catch {
      /* Storage can be disabled. */
    }
  });
  let inviteListEl: HTMLDivElement | undefined;

  const validInvites = () =>
    inviteTeam() ? validInviteEmails(inviteSlots(), email()) : [];
  const hasInvalidInvites = () =>
    inviteTeam() &&
    inviteSlots().some(
      (value) => value.trim() !== '' && !isPlausibleEmail(value)
    );
  const tooManyInvites = () => validInvites().length > PREFILL_CAP;

  // The X means "don't invite this person", so it belongs on rows that name
  // one. Blank rows need no removing — they're dropped on submit anyway.
  const canRemoveSlot = (value: string) => value.trim() !== '';

  const addEmptyInvite = () => {
    setInviteSlots((slots) => [...slots, '']);
    requestAnimationFrame(() => {
      inviteListEl?.lastElementChild?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    });
  };

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
    <div class="flex flex-col gap-3">
      {/* Same row shape as an invite, with the remove gutter left empty, so
          every input in the form shares one width. Labelled, because the
          name arrives pre-filled — a placeholder alone would be invisible
          exactly when the field needs explaining. */}
      <div class="flex items-center gap-1.5">
        <div class="flex min-w-0 flex-1 flex-col gap-1.5">
          <label for="team-name" class="text-xs text-ink-muted">
            Team name
          </label>
          <FormInput
            id="team-name"
            // An example, not "Team name" again — the label says that.
            placeholder="Acme Inc."
            value={name()}
            autoFocus={!props.domain}
            onInput={setName}
          />
        </div>
        <div class="size-7 shrink-0" />
      </div>

      <label class="flex items-center gap-3 rounded-2xl border border-edge bg-surface p-4">
        <input
          type="checkbox"
          checked={inviteTeam()}
          onChange={(event) => setInviteTeam(event.currentTarget.checked)}
          class="size-4 accent-current"
        />
        <span class="flex flex-col gap-1">
          <span class="text-sm font-medium">Invite my team</span>
          <span class="text-xs leading-5 text-ink-muted">
            Send an email invitation to the people below. Start with up to{' '}
            {PREFILL_CAP} teammates; invite more from Settings later.
          </span>
        </span>
      </label>
      <Show when={inviteTeam()}>
        {/* Index, not For: slots are edited strings, and For keys by value —
          each keystroke would recreate the input node and drop focus.
          No inner scroller: the list opens pre-filled now, and a capped box
          left a row sliced in half above the buttons — the flow's own
          scroll container takes the height instead. */}
        <div ref={(el) => (inviteListEl = el)} class="flex flex-col gap-3">
          <Index each={inviteSlots()}>
            {(slot, i) => (
              <div class="flex items-center gap-1.5">
                <div class="min-w-0 flex-1">
                  <FormInput
                    id={`invite-${i}`}
                    type="email"
                    label={`Teammate ${i + 1} email`}
                    invalid={slot().trim() !== '' && !isPlausibleEmail(slot())}
                    placeholder="teammate@company.com"
                    value={slot()}
                    onInput={(value) =>
                      setInviteSlots((slots) =>
                        slots.map((v, j) => (j === i ? value : v))
                      )
                    }
                  />
                </div>
                {/* Gutter is always reserved, so a blank row's input still lines
                  up with the ones carrying a remove button. */}
                <div class="flex size-7 shrink-0 items-center justify-center">
                  <Show when={canRemoveSlot(slot())}>
                    <button
                      type="button"
                      aria-label={`Don't invite ${slot().trim()}`}
                      title={`Don't invite ${slot().trim()}`}
                      onClick={() =>
                        setInviteSlots((slots) => removeInviteSlot(slots, i))
                      }
                      class="rounded-md p-1.5 text-ink-extra-muted transition-colors hover:bg-ink/5 hover:text-ink"
                    >
                      <XIcon class="size-4" />
                    </button>
                  </Show>
                </div>
              </div>
            )}
          </Index>
        </div>

        <Button
          variant="ghost"
          size="sm"
          class="self-center text-ink-muted"
          onClick={addEmptyInvite}
          disabled={
            inviteSlots().length >= PREFILL_CAP + 1 || createTeam.isPending
          }
        >
          <Plus class="size-4" />
          Add another teammate
        </Button>
      </Show>
      <Show when={hasInvalidInvites()}>
        <p role="alert" class="text-xs text-failure">
          Enter a valid email address for each teammate, or remove that row.
        </p>
      </Show>
      <Show when={tooManyInvites()}>
        <p role="alert" class="text-xs text-failure">
          Choose up to {PREFILL_CAP} teammates to invite during setup.
        </p>
      </Show>
      <ContinueButton
        label={
          validInvites().length > 0
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
      <SkipButton disabled={createTeam.isPending} onClick={props.onSkip} />
    </div>
  );
}
