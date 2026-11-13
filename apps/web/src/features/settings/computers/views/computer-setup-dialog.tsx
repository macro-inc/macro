import { openAgentsPage } from '@app/features/agents-view/primitives/open-page';
import { t } from '@app/lib/i18n';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { toast } from '@core/component/Toast/Toast';
import { useSettingsState } from '@core/constant/SettingsState';
import { isMobile } from '@core/mobile/isMobile';
import { fireAndForget } from '@core/util/fireAndForget';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import CheckIcon from '@icon/system/regular/check.svg';
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
import { ActionDialogShell, Button, cn, Input, Spinner } from '@ui';
import {
  createEffect,
  createUniqueId,
  For,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { match, P } from 'ts-pattern';
import { ChoiceRow } from '../../primitives';
import { SetupProgressList } from '../components/setup-progress-list';
import {
  computerFailureMessage,
  isProvisioning,
} from '../core/computer-display';
import { setupSettled, setupStages } from '../core/setup-progress';
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

/** Phones get Buy › Agent › Your AI › Ready, so the bar stays on one line. */
function stepLabel(step: SetupStepId): string {
  return match([step, isMobile()] as const)
    .with(['computer', true], () => t('computers.stepBuyShort'))
    .with(['computer', false], () => t('computers.stepBuy'))
    .with(['agent', true], () => t('computers.stepConfigureAgentShort'))
    .with(['agent', false], () => t('computers.stepConfigureAgent'))
    .with(['claude', true], () => t('computers.stepBringAiShort'))
    .with(['claude', false], () => t('computers.stepBringAi'))
    .with(['ready', P.boolean], () => t('computers.stepReady'))
    .exhaustive();
}

/**
 * Buy computer → Configure agent → Bring your AI → Ready: done steps carry a
 * check, the current one is in ink, and a step the choice skips is struck.
 */
export function StepHeader(props: { step: SetupStepId; skipsClaude: boolean }) {
  const current = () => STEP_ORDER.indexOf(props.step);
  return (
    <ol
      aria-label={t('computers.setupSteps')}
      class="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs"
    >
      <For each={STEP_ORDER}>
        {(step, index) => {
          const done = () => index() < current();
          const active = () => index() === current();
          return (
            <li
              class={cn(
                'flex items-center gap-1.5',
                active() && 'font-medium text-ink',
                done() && 'text-ink-muted',
                !active() && !done() && 'text-ink-extra-muted',
                step === 'claude' && props.skipsClaude && 'line-through'
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
              {stepLabel(step)}
            </li>
          );
        }}
      </For>
    </ol>
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
  const header = (): JSX.Element => (
    <div class="flex flex-col gap-4">
      <StepHeader
        step={props.step}
        skipsClaude={props.choice === 'macro_credits'}
      />
      <Show when={showProgress()}>
        <SetupProgressList
          computer={props.computer}
          signsIn={props.choice === 'own_account'}
          connected={props.connected}
          signedIn={done()}
          onRetry={() => fireAndForget(retrySetup(), 'computer-setup')}
          retrying={retry.isPending}
        />
      </Show>
    </div>
  );

  // The stage the computer is on, for "Preparing sign-in… starting up · 0:42".
  const elapsed = useSetupElapsed(() => props.computer);
  const currentStage = () =>
    setupStages(props.computer, {
      signsIn: true,
      connected: props.connected,
      signedIn: done(),
    }).find((stage) => stage.state === 'current' || stage.state === 'failed');

  return (
    <Switch>
      <Match when={props.step === 'agent'}>
        <ActionDialogShell.Body>
          {header()}
          <ActionDialogShell.Header>
            <ActionDialogShell.Title>
              {t('computers.setupAgentTitle')}
            </ActionDialogShell.Title>
            <ActionDialogShell.Description>
              {t('computers.setupAgentBody')}
            </ActionDialogShell.Description>
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
          <fieldset class="flex flex-col gap-2">
            <legend class="mb-2 text-sm leading-5 text-ink-muted">
              {t('computers.claudeChoice')}
            </legend>
            <ChoiceRow
              name="computer-claude-choice"
              value="own_account"
              checked={props.choice === 'own_account'}
              title={t('computers.claudeOwnChoice')}
              description={t('computers.claudeOwnChoiceHint')}
              onChange={() => props.onChoice('own_account')}
            />
            <ChoiceRow
              name="computer-claude-choice"
              value="macro_credits"
              checked={props.choice === 'macro_credits'}
              title={t('computers.claudeCreditsChoice')}
              description={t('computers.claudeCreditsChoiceHint')}
              onChange={() => props.onChoice('macro_credits')}
            />
          </fieldset>
        </ActionDialogShell.Body>
        <ActionDialogShell.Footer>
          <Button type="button" variant="ghost" onClick={props.onClose}>
            {t('common.close')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!props.choice || !agentName().trim()}
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
              {t('computers.signInWaitingBody')}
            </ActionDialogShell.Description>
          </ActionDialogShell.Header>
          {/* No greyed button: the step says what it is waiting for. */}
          <p
            role="status"
            class="flex items-center gap-2 text-sm font-medium text-ink"
          >
            <Spinner size="sm" decorative />
            {t('computers.preparingSignInStatus', {
              stage: (
                currentStage()?.label ?? t('computers.computerStarting')
              ).toLowerCase(),
              elapsed: elapsed() ?? '0:00',
            })}
          </p>
          <p class="text-sm text-ink-muted">
            {t('computers.setupContinuesInBackground')}
          </p>
          <p class="text-sm text-ink-muted">
            {t('computers.claudeSharedAccount')}
          </p>
        </ActionDialogShell.Body>
        <ActionDialogShell.Footer>
          <Button type="button" variant="ghost" onClick={props.onClose}>
            {t('common.close')}
          </Button>
          <Button type="button" variant="secondary" onClick={useCreditsInstead}>
            {t('computers.claudeUseCreditsInstead')}
          </Button>
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
                ? t('computers.setupDoneBody', {
                    computer: props.computer.name,
                  })
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
        <ActionDialogShell.Footer>
          <Button type="button" variant="ghost" onClick={props.onClose}>
            {t('computers.done')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={!done()}
            onClick={tryIt}
          >
            {t('computers.tryIt')}
          </Button>
        </ActionDialogShell.Footer>
      </Match>
    </Switch>
  );
}
