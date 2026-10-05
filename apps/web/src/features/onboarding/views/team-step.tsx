import { Match, Show, Switch } from 'solid-js';
import { ContinueButton, SkipButton } from '../components/controls';
import {
  InvitesPanel,
  OnTeamPanel,
  TeamLoadError,
  TeamStatus,
} from '../components/team-panels';
import { TeamSetup, TeamSetupFields } from '../components/team-setup';
import { useOnboardingContext } from '../context/onboarding-context';
import {
  createTeamForm,
  createTeamStep,
  type TeamFormSeed,
  teamFormSeed,
} from '../primitives/team-step';

/** Set up your team: already a member → confirmation, pending invites →
 * join, otherwise create (with a domain-derived name and same-domain
 * teammates pre-added to the invite list). */
export function TeamStep(props: {
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
  // fully formed — nothing rewrites the user's rows afterwards.
  const seed = () =>
    teamFormSeed({
      record: record(),
      contacts: directory.contacts(),
      ownEmail: ownEmail(),
    });

  return (
    <TeamSetup>
      <Switch>
        <Match when={team.state().t === 'error'}>
          <TeamLoadError onRetry={team.retry} />
        </Match>
        <Match when={team.state().t === 'loading'}>
          <TeamStatus message="Loading your team…" />
        </Match>
        <Match when={onTeam(team.state())} keyed>
          {(name) => <OnTeamPanel name={name} onContinue={props.onContinue} />}
        </Match>
        <Match when={pendingInvites(team.state())}>
          {(invites) => (
            <InvitesPanel
              invites={invites()}
              joining={team.joining()}
              onJoin={(id) => void team.join(id)}
              onSkip={props.onSkip}
            />
          )}
        </Match>
        <Match when={team.state().t === 'create'}>
          <Show
            when={seed()}
            keyed
            fallback={<TeamStatus message="Finding your teammates…" />}
          >
            {(ready) => (
              <TeamForm
                seed={ready}
                ownEmail={ownEmail()}
                onContinue={props.onContinue}
                onSkip={props.onSkip}
              />
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

function TeamForm(props: {
  seed: TeamFormSeed;
  ownEmail: string | undefined;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const context = useOnboardingContext();
  const form = createTeamForm(context, props.seed, {
    ownEmail: props.ownEmail,
    onCreated: props.onContinue,
  });
  return (
    <div class="flex flex-col gap-3">
      <TeamSetupFields
        id="team"
        name={form.name()}
        emails={form.slots()}
        disabled={form.pending()}
        suggested={form.suggested}
        onNameChange={form.setName}
        onEmailChange={form.setSlot}
        onRemoveEmail={form.removeSlot}
        onAddEmail={form.addSlot}
      />
      <ContinueButton
        label={
          form.pending()
            ? 'Creating workspace…'
            : form.invites().length > 0
              ? `Create team & invite ${form.invites().length}`
              : 'Create team'
        }
        disabled={!form.canCreate()}
        onClick={() => void form.create()}
      />
      <SkipButton disabled={form.pending()} onClick={props.onSkip} />
    </div>
  );
}
