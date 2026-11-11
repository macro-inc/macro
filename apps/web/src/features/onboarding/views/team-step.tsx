import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import InfoIcon from '@icon/system/regular/info.svg';
import LinkIcon from '@icon/system/regular/link.svg';
import { Popover } from '@kobalte/core/popover';
import { Button, ToggleSwitch } from '@ui';
import {
  createMemo,
  createSignal,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
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
  // How many teammates this step just emailed, so the confirmation can ask
  // the creator to give them a heads-up.
  const [invited, setInvited] = createSignal(0);
  // A personal address has no team to create; it refers friends instead.
  const referring = () => {
    const ready = seed();
    return team.state().t === 'create' && ready !== undefined && ready.personal;
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
              invited={invited()}
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
                when={!ready().personal}
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
                  onInvited={setInvited}
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

/** A full-width team option switch marked recommended, with an info button
 * between its label and control. The switch root lays its parts into the row
 * (`contents`) so the info button sits outside the label: pressing it never
 * toggles the switch or joins its accessible name. */
function RecommendedSwitch(props: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  info: string;
  infoLabel: string;
  children: JSX.Element;
}) {
  return (
    <div class="flex w-full items-center gap-1.5">
      <ToggleSwitch
        size="md"
        class="contents"
        labelClass="order-1 data-disabled:opacity-50"
        controlClass="order-3 ml-auto shrink-0 data-disabled:opacity-50"
        checked={props.checked}
        disabled={props.disabled}
        onChange={props.onChange}
        label={
          <span class="text-xs text-ink sm:text-sm">
            {props.children}
            <span class="ml-1 whitespace-nowrap rounded bg-ink/5 px-1 py-0.5 align-middle text-[9px] text-ink-muted opacity-60 sm:ml-2 sm:px-1.5 sm:text-[10px]">
              recommended
            </span>
          </span>
        }
      />
      <div class="order-2 flex">
        <InfoHint label={props.infoLabel}>{props.info}</InfoHint>
      </div>
    </div>
  );
}

/** An (i) button explaining a setting: a tooltip on hover or focus, and on
 * touch, where tooltips are off, a popover on tap. */
function InfoHint(props: { label: string; children: string }) {
  const [trigger, setTrigger] = createSignal<HTMLButtonElement>();
  return (
    <Show
      when={isTouchDevice()}
      fallback={
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={props.label}
          aria-description={props.children}
          class="text-ink-muted"
          tooltip={{
            content: (
              <span class="block max-w-64 text-left leading-relaxed">
                {props.children}
              </span>
            ),
            placement: 'top',
          }}
        >
          <InfoIcon class="size-3.5" aria-hidden="true" />
        </Button>
      }
    >
      <Popover placement="top" gutter={8} modal={false}>
        <Popover.Trigger
          as={Button}
          ref={setTrigger}
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={props.label}
          class="text-ink-muted"
        >
          <InfoIcon class="size-3.5" aria-hidden="true" />
        </Popover.Trigger>
        <Popover.Portal
          mount={trigger()?.closest<HTMLElement>('.portal-scope') ?? undefined}
        >
          <Popover.Content class="menu-surface z-action-menu w-72 max-w-[min(18rem,var(--kb-popper-content-available-width),calc(100vw-2rem))] p-3 text-xs leading-relaxed whitespace-normal break-words outline-none">
            <Popover.Title class="sr-only">{props.label}</Popover.Title>
            <Popover.Description>{props.children}</Popover.Description>
          </Popover.Content>
        </Popover.Portal>
      </Popover>
    </Show>
  );
}

/** Creating the team switches the step to the on-team confirmation, where
 * the creator can copy the team's invite link before continuing. */
function TeamForm(props: {
  finishing: boolean;
  seed: TeamFormSeed;
  ownEmail: string | undefined;
  onInvited: (count: number) => void;
}) {
  const context = useOnboardingContext();
  const form = createTeamForm(context, props.seed, {
    ownEmail: props.ownEmail,
    onCreated: (sent) => props.onInvited(sent.length),
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
            <div class="flex w-full flex-col gap-4 border-t border-edge-muted pt-6">
              <RecommendedSwitch
                checked={form.allowDomainJoin()}
                onChange={form.setAllowDomainJoin}
                infoLabel="About domain join"
                info={`Anyone who signs up with an @${domain()} email joins this team automatically. You can turn this off later in Settings.`}
              >
                Allow @{domain()} emails to join
              </RecommendedSwitch>
              {/* The notice invites colleagues to join by domain, so it
                  reads as off and can't be turned on without domain join. */}
              <RecommendedSwitch
                checked={form.notifyDomain()}
                disabled={!form.allowDomainJoin()}
                onChange={form.setNotifyDomain}
                infoLabel="About the team email"
                info={`We'll email your @${domain()} contacts who aren't on Macro yet to let them know the team exists. Needs domain join on.`}
              >
                Notify your team via email
              </RecommendedSwitch>
            </div>
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
