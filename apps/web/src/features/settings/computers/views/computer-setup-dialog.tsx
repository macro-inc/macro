import { openAgentsPage } from '@app/features/agents-view/primitives/open-page';
import { requestCreateAgent } from '@app/features/settings/agentSettingsState';
import { t } from '@app/lib/i18n';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { toast } from '@core/component/Toast/Toast';
import { useSettingsState } from '@core/constant/SettingsState';
import { isMobile } from '@core/mobile/isMobile';
import { fireAndForget } from '@core/util/fireAndForget';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import MinusIcon from '@icon/system/regular/minus.svg';
import {
  type AgentWithHarnessId,
  invalidateAgents,
  useAgentsQuery,
} from '@queries/agents/agents';
import { useUpdateBotMutation } from '@queries/bots/bots';
import { useClaudeSignOutMutation } from '@queries/computers/claude';
import {
  useCompleteComputerSetupMutation,
  useRetryComputerMutation,
} from '@queries/computers/computers';
import { invalidateHarnesses } from '@queries/harnesses/harnesses';
import type { ClaudeMode } from '@service-agent-harness/generated/schemas';
import type { ComputerStatus } from '@service-auth/computers';
import { ActionDialogShell, Button, cn, Input, Spinner, Tabs } from '@ui';
import {
  createEffect,
  createSignal,
  createUniqueId,
  For,
  type JSX,
  Match,
  on,
  Show,
  Switch,
} from 'solid-js';
import { match } from 'ts-pattern';
import { SetupProgressHeader } from '../components/setup-progress-header';
import {
  computerFailureMessage,
  isProvisioning,
} from '../core/computer-display';
import {
  currentSetupStage,
  type SignInPlan,
  setupSettled,
  setupStages,
} from '../core/setup-progress';
import { useSetupElapsed } from '../primitives/setup-elapsed';
import { ClaudeSignInFlow } from './claude-sign-in-flow';

export type SetupStepId = 'computer' | 'agent' | 'claude' | 'ready';

/** "Maya's Agent", or "Agent" for a viewer without a first name. */
export function defaultAgentName(firstName: string | undefined): string {
  return firstName
    ? t('computers.defaultAgentName', { name: firstName })
    : t('computers.defaultAgentNameFallback');
}

/** The computer is up and its runtime connected: Claude can be set now. */
export function computerConnected(
  computer: ComputerStatus | undefined,
  connected: boolean
): boolean {
  return !!computer && !isProvisioning(computer) && connected;
}

const STEP_ORDER: readonly SetupStepId[] = [
  'computer',
  'agent',
  'claude',
  'ready',
];

/** Phones get Buy › Agent › Your AI › Create, so the bar stays on one line. */
function stepLabel(step: SetupStepId): string {
  return match([step, isMobile()] as const)
    .with(['computer', true], () => t('computers.stepBuyShort'))
    .with(['computer', false], () => t('computers.stepBuy'))
    .with(['agent', true], () => t('computers.stepConfigureAgentShort'))
    .with(['agent', false], () => t('computers.stepConfigureAgent'))
    .with(['claude', true], () => t('computers.stepBringAiShort'))
    .with(['claude', false], () => t('computers.stepBringAi'))
    .with(['ready', true], () => t('computers.stepCreateAgentShort'))
    .with(['ready', false], () => t('computers.stepCreateAgent'))
    .exhaustive();
}

/**
 * How the step bar marks Bring your AI: as an ordinary step, skipped (Macro's
 * Claude chosen up front), or done on Macro credits (the sign-in was opened,
 * then Use Macro credits instead).
 */
export type ClaudeStepMark = 'step' | 'skipped' | 'credits';

export function claudeStepMark(
  choice: ClaudeMode | undefined,
  signInVisited: boolean
): ClaudeStepMark {
  if (choice !== 'macro_credits') return 'step';
  return signInVisited ? 'credits' : 'skipped';
}

/**
 * Buy computer → Configure agent → Bring your AI → Create agent: done steps
 * carry a check, the current one is in ink, and a step the choice skips is
 * muted with a dash.
 */
export function StepHeader(props: {
  step: SetupStepId;
  claude: ClaudeStepMark;
}) {
  const current = () => STEP_ORDER.indexOf(props.step);
  return (
    <ol
      aria-label={t('computers.setupSteps')}
      class="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs"
    >
      <For each={STEP_ORDER}>
        {(step, index) => {
          // Skipped, not cancelled: muted with a dash, never struck through.
          const skipped = () => step === 'claude' && props.claude === 'skipped';
          const onCredits = () =>
            step === 'claude' && props.claude === 'credits';
          const done = () => index() < current() && !skipped();
          const active = () => index() === current();
          return (
            <li
              class={cn(
                'flex items-center gap-1.5',
                active() && 'font-medium text-ink',
                done() && 'text-ink-muted',
                !active() && !done() && 'text-ink-extra-muted'
              )}
              aria-current={active() ? 'step' : undefined}
            >
              <Show when={index() > 0}>
                <CaretRightIcon
                  aria-hidden="true"
                  class="size-3 shrink-0 text-ink-extra-muted"
                />
              </Show>
              <Show
                when={!skipped()}
                fallback={
                  <MinusIcon
                    aria-hidden="true"
                    class="size-3 shrink-0 text-ink-extra-muted"
                  />
                }
              >
                <Show
                  when={done()}
                  fallback={
                    <span
                      aria-hidden="true"
                      class={cn(
                        'size-1.5 shrink-0 rounded-full',
                        active() ? 'bg-accent' : 'border border-ink-extra-muted'
                      )}
                    />
                  }
                >
                  <CheckIcon aria-hidden="true" class="size-3 shrink-0" />
                </Show>
              </Show>
              <span>
                {stepLabel(step)}
                {/* Phones keep the short label; the word stays for assistive tech. */}
                <Show when={skipped() || onCredits()}>
                  <span class={isMobile() ? 'sr-only' : undefined}>
                    {` · ${t(
                      skipped()
                        ? 'computers.skippedStep'
                        : 'computers.creditsStep'
                    )}`}
                  </span>
                </Show>
              </span>
            </li>
          );
        }}
      </For>
    </ol>
  );
}

/** Why the footer's primary action is disabled, beside it. */
export function DisabledReason(props: { children: JSX.Element }) {
  return (
    <p class="basis-full text-right text-xs text-ink-muted text-pretty">
      {props.children}
    </p>
  );
}

/**
 * Guided setup's Agent, Claude and Ready steps for a bought computer, inside
 * the one setup modal the buy step opened. The host owns the step, the agent
 * name and the Claude choice, so closing and reopening resumes where it was.
 *
 * The user names the agent and picks Claude while the computer provisions;
 * the rename and the Claude choice apply once the computer is up.
 */
export function ComputerSetupSteps(props: {
  computer: ComputerStatus;
  /** The computer's runtime holds a live connection. */
  connected: boolean;
  firstName?: string;
  step: Exclude<SetupStepId, 'computer'>;
  name: string | undefined;
  choice: ClaudeMode | undefined;
  onName: (name: string) => void;
  onChoice: (choice: ClaudeMode) => void;
  onStep: (step: SetupStepId) => void;
  onClose: () => void;
  /**
   * Opened from an agent's Where it runs: closing selects this computer for
   * that agent, so the last step offers that instead of a new agent.
   */
  selectsForAgent?: boolean;
  /** Bring your AI was opened, so choosing credits there completes it. */
  signInVisited?: boolean;
}) {
  const nameId = createUniqueId();
  const agents = useAgentsQuery();
  const renameBot = useUpdateBotMutation();
  const signOut = useClaudeSignOutMutation();
  const completeSetup = useCompleteComputerSetupMutation();
  const retry = useRetryComputerMutation();
  const layout = useSplitLayout();
  const settings = useSettingsState();

  const up = () => computerConnected(props.computer, props.connected);
  const harnessId = () => props.computer.harnessId ?? undefined;
  // Bots are soft-deleted: trust defaultAgentId only while the agent exists.
  const agent = (): AgentWithHarnessId | undefined =>
    agents.isSuccess
      ? agents.data.find(
          (item) => item.bot.id === props.computer.defaultAgentId
        )
      : undefined;
  const agentName = () =>
    props.name ?? agent()?.bot.name ?? defaultAgentName(props.firstName);
  const done = () => !!props.computer.setupCompletedAt;

  // The computer's agent is created server-side once it first comes up, so
  // a list cached before then lacks it; refetch once per agent id. The
  // composer's roster reads the same list, so Try it can select it.
  createEffect(
    on(
      () => props.computer.defaultAgentId,
      (agentId) => {
        if (
          agentId &&
          agents.isSuccess &&
          !agents.data.some((item) => item.bot.id === agentId)
        )
          fireAndForget(invalidateAgents(), 'computer-setup');
      }
    )
  );

  const rename = async (current: AgentWithHarnessId) => {
    const trimmed = agentName().trim();
    if (!trimmed || trimmed === current.bot.name) return;
    await renameBot.mutateAsync({ botId: current.bot.id, name: trimmed });
    await invalidateAgents();
  };

  // Finish once the computer is up: rename, then Claude, then setup-complete.
  // With the user's own account, the sign-in step completes it instead.
  const finish = async () => {
    const current = agent();
    const id = harnessId();
    if (!current || !id || done()) return;
    await rename(current);
    if (props.choice === 'macro_credits') await signOut.mutateAsync(id);
    await completeSetup.mutateAsync(props.computer.id);
    await invalidateHarnesses();
  };
  let finishing = false;
  createEffect(() => {
    if (
      props.step !== 'ready' ||
      props.choice !== 'macro_credits' ||
      !up() ||
      !agent() ||
      done() ||
      finishing
    )
      return;
    finishing = true;
    fireAndForget(
      (async () => {
        try {
          await finish();
        } finally {
          finishing = false;
        }
      })(),
      'computer-setup'
    );
  });

  const signedIn = async () => {
    const current = agent();
    if (current) await rename(current);
    await completeSetup.mutateAsync(props.computer.id);
    // Refresh first, so the row behind no longer offers Sign in with Claude.
    await invalidateHarnesses();
    props.onStep('ready');
  };

  const useCreditsInstead = () => {
    props.onChoice('macro_credits');
    props.onStep('ready');
  };

  // Both fields sit just above Continue, so it needs no line saying why.
  const canContinue = () => !!agentName().trim() && !!props.choice;

  const continueFromAgent = () => {
    props.onStep(props.choice === 'own_account' ? 'claude' : 'ready');
  };

  // Try it: a new conversation in Code with this computer's agent selected.
  const tryIt = () => {
    const botId = props.computer.defaultAgentId;
    props.onClose();
    if (isMobile()) settings.closeSettings();
    openAgentsPage(layout, 'new', botId ? { composerAgentId: botId } : {});
  };

  // The create form, with this computer chosen under Where it runs. The tab
  // switches first, so the Agents page there takes the request.
  const createAgentHere = () => {
    const id = harnessId();
    props.onClose();
    if (props.selectsForAgent || !id) return;
    settings.openSettings('Agents');
    requestCreateAgent(id);
  };

  const retrySetup = async () => {
    try {
      await retry.mutateAsync(props.computer.id);
    } catch (error) {
      toast.failure(computerFailureMessage(error, t('computers.retryFailed')));
    }
  };

  // Setup carries on behind every step: the list says where it is, how long
  // the current stage has taken, and what to do when it is stuck.
  const showProgress = () =>
    !setupSettled(props.computer) ||
    (props.choice === 'own_account' && !done());
  const signInPlan = (): SignInPlan =>
    match(props.choice)
      .returnType<SignInPlan>()
      .with('own_account', () => 'needed')
      .with('macro_credits', () => 'skipped')
      .with(undefined, () => 'undecided')
      .exhaustive();
  const [progressExpanded, setProgressExpanded] = createSignal(false);
  const header = (): JSX.Element => (
    <SetupProgressHeader
      steps={
        <StepHeader
          step={props.step}
          claude={claudeStepMark(props.choice, props.signInVisited ?? false)}
        />
      }
      computer={props.computer}
      signIn={signInPlan()}
      connected={props.connected}
      signedIn={done()}
      showProgress={showProgress()}
      expanded={progressExpanded()}
      onExpandedChange={setProgressExpanded}
      onRetry={() => fireAndForget(retrySetup(), 'computer-setup')}
      retrying={retry.isPending}
    />
  );

  // Failed, or stuck until someone acts: setup is not moving on its own.
  const setupStopped = () =>
    props.computer.status === 'failed' ||
    props.computer.status === 'needs_attention';

  // The stage the computer is on, for "Preparing sign-in… starting up · 0:42".
  const elapsed = useSetupElapsed(() => props.computer);
  const currentStage = () =>
    currentSetupStage(
      setupStages(props.computer, {
        signIn: 'needed',
        connected: props.connected,
        signedIn: done(),
      })
    );

  return (
    <Switch>
      <Match when={props.step === 'agent'}>
        <ActionDialogShell.Body>
          {header()}
          <ActionDialogShell.Header>
            <ActionDialogShell.Title>
              {t('computers.setupAgentTitle')}
            </ActionDialogShell.Title>
          </ActionDialogShell.Header>
          <div class="flex flex-col gap-2">
            <label for={nameId} class="text-sm leading-5 text-ink-muted">
              {t('computers.agentName')}
            </label>
            <Input
              id={nameId}
              value={agentName()}
              maxLength={64}
              onInput={(event) => props.onName(event.currentTarget.value)}
            />
          </div>
          <div class="flex flex-col gap-2">
            <span aria-hidden="true" class="text-sm leading-5 text-ink-muted">
              {t('computers.claudeChoice')}
            </span>
            {/* Each option's hint is its description and desktop tooltip. */}
            <Tabs
              aria-label={t('computers.claudeChoice')}
              fullWidth
              touch="segmented"
              options={[
                {
                  value: 'own_account',
                  label: t('computers.claudeOwnChoice'),
                  tooltip: t('computers.claudeOwnChoiceHint'),
                },
                {
                  value: 'macro_credits',
                  label: t('computers.claudeCreditsChoice'),
                  tooltip: t('computers.claudeCreditsChoiceHint'),
                },
              ]}
              value={props.choice}
              onChange={props.onChoice}
            />
          </div>
        </ActionDialogShell.Body>
        <ActionDialogShell.Footer>
          <Button type="button" variant="ghost" onClick={props.onClose}>
            {t('common.close')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!canContinue()}
            onClick={continueFromAgent}
          >
            {t('computers.continue')}
          </Button>
        </ActionDialogShell.Footer>
      </Match>
      <Match when={props.step === 'claude' && up() && harnessId()}>
        {(id) => (
          <ClaudeSignInFlow
            harnessId={id()}
            entry="computer_setup"
            header={header()}
            title={t('computers.signInToClaude')}
            onSignedIn={() => fireAndForget(signedIn(), 'computer-setup')}
            onUseCredits={useCreditsInstead}
          />
        )}
      </Match>
      <Match when={props.step === 'claude'}>
        <ActionDialogShell.Body>
          {header()}
          <ActionDialogShell.Header>
            <ActionDialogShell.Title>
              {t('computers.signInToClaude')}
            </ActionDialogShell.Title>
            <ActionDialogShell.Description>
              {setupStopped()
                ? t('computers.signInWaitsForRetry')
                : t('computers.signInWaitingBody')}
            </ActionDialogShell.Description>
          </ActionDialogShell.Header>
          {/* No greyed button: the step says what it is waiting for. A
              stopped setup is not progressing, so nothing spins or counts. */}
          <Show when={!setupStopped()}>
            <p
              role="status"
              class="flex items-center gap-2 text-sm font-medium text-ink"
            >
              <Spinner size="sm" decorative />
              {t('computers.preparingSignInStatus', {
                stage: currentStage()?.label ?? t('computers.computerStarting'),
                elapsed: elapsed() ?? '0:00',
              })}
            </p>
            <p class="text-sm text-ink-muted">
              {t('computers.setupContinuesInBackground')}
            </p>
            {/* No sign-in can happen until setup is retried. */}
            <p class="text-sm text-ink-muted">
              {t('computers.claudeSharedAccount')}
            </p>
          </Show>
        </ActionDialogShell.Body>
        <ActionDialogShell.Footer>
          <Button type="button" variant="ghost" onClick={props.onClose}>
            {t('common.close')}
          </Button>
          {/* Choosing Macro's Claude cannot finish a computer that is not up. */}
          <Show when={!setupStopped()}>
            <Button
              type="button"
              variant="secondary"
              onClick={useCreditsInstead}
            >
              {t('computers.claudeUseCreditsInstead')}
            </Button>
          </Show>
        </ActionDialogShell.Footer>
      </Match>
      <Match when={props.step === 'ready'}>
        <ActionDialogShell.Body>
          {header()}
          <ActionDialogShell.Header>
            <ActionDialogShell.Title>
              {done()
                ? t('computers.setupDoneTitle', { agent: agentName() })
                : t('computers.almostReady')}
            </ActionDialogShell.Title>
            <ActionDialogShell.Description>
              {done()
                ? t(
                    props.selectsForAgent
                      ? 'computers.setupDoneBodyForAgent'
                      : 'computers.setupDoneBody',
                    {
                      agent: agentName(),
                      computer: props.computer.name,
                    }
                  )
                : t('computers.almostReadyBody', {
                    computer: props.computer.name,
                  })}
            </ActionDialogShell.Description>
          </ActionDialogShell.Header>
          <Show when={!done()}>
            <p class="text-sm text-ink-muted">
              {t('computers.setupContinuesInBackground')}
            </p>
          </Show>
        </ActionDialogShell.Body>
        {/* Three actions do not fit one phone row: stack them, Try it on top. */}
        <ActionDialogShell.Footer class="touch:flex-col-reverse touch:items-stretch">
          <Button type="button" variant="ghost" onClick={props.onClose}>
            {t('computers.done')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!done()}
            onClick={createAgentHere}
          >
            {props.selectsForAgent
              ? t('computers.useForThisAgent')
              : t('computers.createAgentHere')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!done()}
            onClick={tryIt}
          >
            {t('computers.tryIt')}
          </Button>
          <Show when={!done()}>
            <DisabledReason>{t('computers.tryItAfterSetup')}</DisabledReason>
          </Show>
        </ActionDialogShell.Footer>
      </Match>
    </Switch>
  );
}
