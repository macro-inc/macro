import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useEmail } from '@core/context/user';
import { idToDisplayName } from '@core/user/util';
import type { CollectionNode } from '@kobalte/core';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import Plus from '@phosphor/plus.svg';
import UploadIcon from '@phosphor/upload-simple.svg';
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
import { Button, Select } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Index,
  Show,
} from 'solid-js';
import { ContinueButton, deriveTeamName, FormInput } from './shared';
import {
  prefillableTeammates,
  removeInviteSlot,
  validInviteEmails,
} from './teamInvites';
import {
  createTeamLogoUpload,
  STARTUP_TYPE_OPTIONS,
  type StartupTypeOption,
} from './teamProfile';

/** Set up your team: already a member → confirmation, pending invites →
 * join (or create your own instead), otherwise create (with a domain-derived
 * name and same-domain teammates pre-added to the invite list).
 *
 * Mandatory: there is no skip. The step only advances once the user is on a
 * team — auto-joined, invite accepted, or created here. */
export function TeamStep(props: { onContinue: () => void }) {
  const analytics = useAnalytics();
  const teamsQuery = useUserTeamsQuery();
  const invitesQuery = useUserInvitesQuery();

  const team = createMemo(() => teamsQuery.data?.[0]);
  const invites = createMemo(() => invitesQuery.data?.invites ?? []);
  // A user with pending invites who would rather start their own team.
  const [createInstead, setCreateInstead] = createSignal(false);

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
        <OnTeamPanel
          name={team()?.name}
          logoUrl={team()?.logo_url ?? undefined}
          onContinue={props.onContinue}
        />
      }
    >
      <Show
        when={invites().length === 0 || createInstead()}
        fallback={
          <InvitesPanel
            invites={invites()}
            onCreateInstead={() => setCreateInstead(true)}
          />
        }
      >
        <CreateTeamForm onContinue={props.onContinue} />
      </Show>
    </Show>
  );
}

/** Already on a team — auto-joined by domain, or just created/joined here. */
function OnTeamPanel(props: {
  name?: string;
  logoUrl?: string;
  onContinue: () => void;
}) {
  return (
    <div class="flex flex-col gap-3">
      <div class="flex flex-col items-center gap-2 py-4 text-center">
        {/* The team's own logo when it has one; the check otherwise. */}
        <Show
          when={props.logoUrl}
          fallback={
            <span class="flex size-10 items-center justify-center rounded-full bg-success-bg text-success">
              <CheckIcon class="size-5" />
            </span>
          }
        >
          {(url) => (
            <img
              src={url()}
              alt=""
              class="size-12 rounded-lg border border-edge object-cover"
            />
          )}
        </Show>
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

/** Pending team invites — join one and move on, or create your own team
 * instead. Not skippable: one of the two has to happen. */
function InvitesPanel(props: {
  invites: TeamInviteDetails[];
  onCreateInstead: () => void;
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
      <Button
        variant="ghost"
        size="sm"
        class="self-center text-ink-muted"
        disabled={joinTeam.isPending}
        onClick={props.onCreateInstead}
      >
        Create a new team instead
      </Button>
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
      />
    </Show>
  );
}

/** The create-team form proper — mounted with its prefill inputs resolved,
 * so the name and invite slots initialize once and stay user-owned. Captures
 * the team's name, what kind of startup it is (required), an optional logo,
 * and the teammates to invite. */
function TeamForm(props: {
  domain: string | undefined;
  prefilledTeammates: string[];
  onContinue: () => void;
}) {
  const analytics = useAnalytics();
  const email = useEmail();
  const createTeam = useCreateTeamWithInvitesMutation();

  const [name, setName] = createSignal(
    props.domain ? deriveTeamName(props.domain) : ''
  );
  // Required: the type of startup is the one thing every team tells us
  // about itself, so the workspace can be tailored to it later.
  const [startupType, setStartupType] = createSignal<StartupTypeOption | null>(
    null
  );
  // Optional. The image is uploaded as soon as it's picked; the team only
  // stores the resulting URL.
  const [logoUrl, setLogoUrl] = createSignal<string | undefined>();
  const logoUpload = createTeamLogoUpload(setLogoUrl);
  // Same-domain teammates are pre-added rather than offered: the default is
  // "invite them", and removing a row is how you opt one out.
  const prefilled = props.prefilledTeammates;
  const [inviteSlots, setInviteSlots] = createSignal<string[]>(
    prefilled.length > 0 ? [...prefilled, ''] : ['', '']
  );
  let inviteListEl: HTMLDivElement | undefined;

  const validInvites = () => validInviteEmails(inviteSlots(), email());

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

  // Name and startup type are required; a logo upload in flight blocks too,
  // so the team isn't created without the logo the user just picked.
  const canCreate = () =>
    name().trim().length > 0 &&
    startupType() !== null &&
    !createTeam.isPending &&
    !logoUpload.uploading();

  const create = async () => {
    const type = startupType();
    if (!canCreate() || !type) return;
    // The mutation owns its toasts; stay put (form intact) on failure.
    const invites = validInvites();
    try {
      await createTeam.mutateAsync({
        name: name().trim(),
        startup_type: type.value,
        logo_url: logoUrl(),
        invites: invites.map((address) => ({ email: address })),
      });
    } catch {
      return;
    }
    const kept = new Set(invites);
    analytics.track('onboarding_v4_team', {
      action: 'created',
      startup_type: type.value,
      logo_uploaded: logoUrl() !== undefined,
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
        <div class="flex min-w-0 flex-1 items-start gap-3">
          {/* Logo tile: the same height as the input beside it. Picking a
              file uploads it immediately, so the tile doubles as preview. */}
          <div class="flex shrink-0 flex-col gap-1.5">
            <span id="team-logo-label" class="text-xs text-ink-muted">
              Logo
            </span>
            <button
              type="button"
              aria-label={logoUrl() ? 'Change team logo' : 'Upload team logo'}
              title={logoUrl() ? 'Change logo' : 'Upload logo'}
              disabled={logoUpload.uploading()}
              onClick={logoUpload.open}
              class="flex size-[46px] items-center justify-center overflow-hidden rounded-lg border border-dashed border-edge bg-surface text-ink-extra-muted transition-colors hover:border-accent hover:text-ink disabled:cursor-progress disabled:opacity-60 data-[has-logo]:border-solid"
              data-has-logo={logoUrl() ? '' : undefined}
            >
              <Show
                when={logoUrl()}
                fallback={
                  <UploadIcon
                    class={`size-5 ${logoUpload.uploading() ? 'animate-pulse' : ''}`}
                  />
                }
              >
                {(url) => (
                  <img src={url()} alt="" class="size-full object-cover" />
                )}
              </Show>
            </button>
          </div>
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
        </div>
        <div class="size-7 shrink-0" />
      </div>

      {/* Startup type: a fixed list (mirrors the server enum) so the answer
          is comparable across teams — no free text. */}
      <div class="flex items-center gap-1.5">
        <div class="flex min-w-0 flex-1 flex-col gap-1.5">
          <span id="startup-type-label" class="text-xs text-ink-muted">
            What kind of startup are you?
          </span>
          <Select<StartupTypeOption>
            options={[...STARTUP_TYPE_OPTIONS]}
            value={startupType()}
            onChange={setStartupType}
            optionValue="value"
            optionTextValue="label"
            placeholder="Select your type of startup"
            gutter={4}
            placement="bottom-start"
            itemComponent={(itemProps: {
              item: CollectionNode<StartupTypeOption>;
            }) => (
              <Select.Item
                item={itemProps.item}
                class="flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm text-ink outline-none data-highlighted:bg-hover"
              >
                <Select.ItemLabel>
                  {itemProps.item.rawValue.label}
                </Select.ItemLabel>
                <Select.ItemIndicator>
                  <CheckIcon class="size-3.5" />
                </Select.ItemIndicator>
              </Select.Item>
            )}
          >
            <Select.Trigger
              aria-labelledby="startup-type-label"
              class="flex w-full items-center justify-between gap-2 rounded-lg border border-edge bg-surface px-4 py-3 text-left text-sm text-ink transition-colors focus:border-accent focus:outline-none data-expanded:border-accent"
            >
              <Select.Value<StartupTypeOption> class="min-w-0 flex-1 truncate data-placeholder-shown:text-ink-placeholder">
                {(state) => state.selectedOption().label}
              </Select.Value>
              <CaretDownIcon class="size-3.5 shrink-0 text-ink-extra-muted" />
            </Select.Trigger>
            <Select.Content class="max-h-72">
              <Select.Listbox />
            </Select.Content>
          </Select>
        </div>
        <div class="size-7 shrink-0" />
      </div>

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
      >
        <Plus class="size-4" />
        Add another teammate
      </Button>

      <ContinueButton
        label={
          validInvites().length > 0
            ? `Create team & invite ${validInvites().length}`
            : 'Create team'
        }
        disabled={!canCreate()}
        onClick={() => void create()}
      />
    </div>
  );
}
