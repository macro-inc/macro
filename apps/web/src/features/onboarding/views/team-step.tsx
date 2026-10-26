import { fireAndForget } from '@core/util/fireAndForget';
import LinkIcon from '@icon/system/regular/link.svg';
import { ToggleSwitch } from '@ui';
import { createMemo, Match, Show, Switch } from 'solid-js';
import {
  ContinueButton,
  SecondaryButton,
  SkipButton,
} from '../components/controls';
import {
  InvitesPanel,
  OnTeamPanel,
  TeamLoadError,
  TeamStatus,
} from '../components/team-panels';
import {
  InviteEmailList,
  TeamSetup,
  TeamSetupFields,
} from '../components/team-setup';
import { useOnboardingContext } from '../context/onboarding-context';
import {
  createReferralForm,
  createTeamForm,
  createTeamInviteLinkCopy,
  createTeamStep,
  type TeamFormSeed,
  teamFormSeed,
} from '../primitives/team-step';

/** Set up your team: already a member → confirmation with the team's invite
 * link, pending invites → join, a work domain → create (with a domain-derived
 * name and same-domain teammates pre-added to the invite list), and a
 * personal address → refer friends instead of creating a team. */
export function TeamStep(props: {
  finishing: boolean;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const context = useOnboardingContext();
  const directory = context.createTeamDirectory();
  const team = createTeamStep(context, directory);
  const record = context.createOnboardingRecord();
  const ownEmail = () => {
    const viewer = context.viewer();
    return viewer.t === 'signed-in' ? viewer.viewer.email : undefined;
  };
  // Wait for contacts and the domain suggestion so the form mounts once,
  // fully formed. Keep the first settled seed so background refreshes cannot
  // replace the form, reset edits, or steal focus from an input.
  const seed = createMemo<TeamFormSeed | undefined>(
    (previous) =>
      previous ??
      teamFormSeed({
        record: record(),
        contacts: directory.contacts(),
        ownEmail: ownEmail(),
      })
  );

  const inviteLink = createTeamInviteLinkCopy(context);
  // A personal address has no team to create; it refers friends instead.
  const referring = () => {
    const ready = seed();
    return team.state().t === 'create' && ready !== undefined && !ready.domain;
  };

  return (
    <TeamSetup
      title={referring() ? 'Invite friends.' : undefined}
      subtitle={
        referring()
          ? 'Get $10 of AI credit for each person who signs up.'
          : undefined
      }
    >
      <Switch>
        <Match when={team.state().t === 'error'}>
          <TeamLoadError onRetry={team.retry} />
        </Match>
        <Match when={team.state().t === 'loading'}>
          <TeamStatus message="Loading your team…" />
        </Match>
        <Match when={onTeam(team.state())} keyed>
          {(name) => (
            <OnTeamPanel
              name={name}
              finishing={props.finishing}
              copyingLink={inviteLink.copying()}
              onCopyLink={() => fireAndForget(inviteLink.copy(), 'onboarding')}
              onContinue={props.onContinue}
            />
          )}
        </Match>
        <Match when={pendingInvites(team.state())}>
          {(invites) => (
            <InvitesPanel
              invites={invites()}
              joining={team.joining() || props.finishing}
              onJoin={(id) => fireAndForget(team.join(id), 'onboarding')}
              onSkip={props.onSkip}
            />
          )}
        </Match>
        <Match when={team.state().t === 'create'}>
          <Show
            when={seed()}
            fallback={<TeamStatus message="Finding your teammates…" />}
          >
            {(ready) => (
              <Show
                when={ready().domain}
                fallback={
                  <ReferralForm
                    finishing={props.finishing}
                    ownEmail={ownEmail()}
                    onContinue={props.onContinue}
                    onSkip={props.onSkip}
                  />
                }
              >
                <TeamForm
                  finishing={props.finishing}
                  seed={ready()}
                  ownEmail={ownEmail()}
                />
              </Show>
            )}
          </Show>
        </Match>
      </Switch>
    </TeamSetup>
  );
}

const onTeam = (
  state: ReturnType<ReturnType<typeof createTeamStep>['state']>
) => (state.t === 'on-team' ? state.name : undefined);

const pendingInvites = (
  state: ReturnType<ReturnType<typeof createTeamStep>['state']>
) => (state.t === 'invites' ? state.invites : undefined);

/** Creating the team switches the step to the on-team confirmation, where
 * the creator can copy the team's invite link before continuing. */
function TeamForm(props: {
  finishing: boolean;
  seed: TeamFormSeed;
  ownEmail: string | undefined;
}) {
  const context = useOnboardingContext();
  const form = createTeamForm(context, props.seed, {
    ownEmail: props.ownEmail,
  });
  return (
    <div class="flex flex-col gap-3">
      <TeamSetupFields
        id="team"
        name={form.name()}
        emails={form.slots()}
        disabled={form.pending() || props.finishing}
        hint="Invite teammates now for $10 AI credit each"
        onNameChange={form.setName}
        onEmailChange={form.setSlot}
        onRemoveEmail={form.removeSlot}
        onAddEmail={form.addSlot}
      >
        <Show when={form.domain}>
          {(domain) => (
            <ToggleSwitch
              size="md"
              class="w-full flex-row-reverse justify-between gap-3 border-t border-edge-muted pt-6"
              controlClass="shrink-0"
              checked={form.allowDomainJoin()}
              onChange={form.setAllowDomainJoin}
              label={
                <span class="flex items-center gap-2 text-sm text-ink">
                  Allow @{domain()} emails to join
                  <span class="rounded bg-ink/5 px-1.5 py-0.5 text-xs text-ink-muted">
                    recommended
                  </span>
                </span>
              }
            />
          )}
        </Show>
      </TeamSetupFields>
      <ContinueButton
        label={
          props.finishing
            ? 'Opening your workspace…'
            : form.pending()
              ? 'Creating workspace…'
              : form.invites().length > 0
                ? `Create team & invite ${form.invites().length}`
                : 'Create team'
        }
        disabled={!form.canCreate() || props.finishing}
        onClick={() => fireAndForget(form.create(), 'onboarding')}
      />
    </div>
  );
}

function ReferralForm(props: {
  finishing: boolean;
  ownEmail: string | undefined;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const context = useOnboardingContext();
  const form = createReferralForm(context, {
    ownEmail: props.ownEmail,
    onSent: props.onContinue,
  });
  const count = () => form.invites().length;
  return (
    <div class="flex flex-col gap-3">
      <fieldset
        disabled={form.sending() || props.finishing}
        class="flex min-w-0 flex-col gap-6 text-left"
      >
        <InviteEmailList
          id="referral"
          emails={form.slots()}
          person="Friend"
          placeholder="friend@example.com"
          onEmailChange={form.setSlot}
          onRemoveEmail={form.removeSlot}
          onAddEmail={form.addSlot}
        />
      </fieldset>
      <ContinueButton
        label={
          props.finishing
            ? 'Opening your workspace…'
            : form.sending()
              ? 'Sending invites…'
              : count() === 0
                ? 'Send invites'
                : `Send ${count()} ${count() === 1 ? 'invite' : 'invites'}`
        }
        disabled={count() === 0 || form.sending() || props.finishing}
        onClick={() => fireAndForget(form.send(), 'onboarding')}
        secondary={
          <SecondaryButton
            label="Copy referral link"
            icon={<LinkIcon class="size-5 shrink-0" aria-hidden="true" />}
            disabled={form.copying() || props.finishing}
            onClick={() => fireAndForget(form.copyLink(), 'onboarding')}
          />
        }
      />
      <SkipButton
        disabled={form.sending() || props.finishing}
        onClick={props.onSkip}
      />
    </div>
  );
}
