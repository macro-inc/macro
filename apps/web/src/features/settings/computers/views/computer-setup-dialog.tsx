import { openAgentsPage } from '@app/features/agents-view/primitives/open-page';
import { t } from '@app/lib/i18n';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSettingsState } from '@core/constant/SettingsState';
import { isMobile } from '@core/mobile/isMobile';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  type AgentWithHarnessId,
  invalidateAgents,
  useAgentsQuery,
} from '@queries/agents/agents';
import { useUpdateBotMutation } from '@queries/bots/bots';
import { useClaudeSignOutMutation } from '@queries/computers/claude';
import { useCompleteComputerSetupMutation } from '@queries/computers/computers';
import { invalidateHarnesses } from '@queries/harnesses/harnesses';
import type { ComputerStatus } from '@service-auth/computers';
import { ActionDialogShell, Button, cn, Input } from '@ui';
import {
  createEffect,
  createUniqueId,
  For,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { ChoiceRow } from '../../primitives';
import {
  isProvisioning,
  SETUP_PHASES,
  setupPhaseIndex,
  setupStepLabel,
} from '../core/computer-display';
import { ClaudeSignInFlow } from './claude-sign-in-flow';

export type SetupStepId = 'computer' | 'agent' | 'claude' | 'ready';
export type ClaudeChoice = 'own_account' | 'macro_credits';

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

function stepLabel(step: SetupStepId): string {
  if (step === 'computer') return t('computers.stepComputer');
  if (step === 'agent') return t('computers.stepAgent');
  if (step === 'claude') return t('computers.stepClaude');
  return t('computers.stepReady');
}

/** Computer · Agent · Claude · Ready, the current one in ink. */
export function StepHeader(props: { step: SetupStepId; skipsClaude: boolean }) {
  const current = () => STEP_ORDER.indexOf(props.step);
  return (
    <ol
      aria-label={t('computers.setupSteps')}
      class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
    >
      <For each={STEP_ORDER}>
        {(step, index) => (
          <li
            class={cn(
              'flex items-center gap-2',
              index() === current()
                ? 'font-medium text-ink'
                : 'text-ink-extra-muted',
              step === 'claude' && props.skipsClaude && 'line-through'
            )}
            aria-current={index() === current() ? 'step' : undefined}
          >
            <Show when={index() > 0}>
              <span aria-hidden="true" class="text-ink-extra-muted">
                ·
              </span>
            </Show>
            {stepLabel(step)}
          </li>
        )}
      </For>
    </ol>
  );
}

/** A thin bar over Creating → Starting → Connecting, while provisioning. */
function ProvisioningBar(props: { computer: ComputerStatus }) {
  const phase = () => setupPhaseIndex(props.computer);
  return (
    <div class="flex flex-col gap-1.5">
      <div
        role="progressbar"
        aria-label={t('computers.settingUp')}
        aria-valuemin={0}
        aria-valuemax={SETUP_PHASES.length}
        aria-valuenow={phase() + 1}
        class="h-1 overflow-hidden rounded-full bg-ink/8"
      >
        <div
          class="h-full rounded-full bg-accent transition-[width] duration-500"
          style={{
            width: `${((phase() + 1) / (SETUP_PHASES.length + 1)) * 100}%`,
          }}
        />
      </div>
      <p class="flex flex-wrap gap-x-1.5 text-xs text-ink-extra-muted">
        <For each={SETUP_PHASES}>
          {(step, index) => (
            <span class={cn(index() === phase() && 'font-medium text-ink')}>
              <Show when={index() > 0}>
                <span aria-hidden="true">→ </span>
              </Show>
              {setupStepLabel(step)}
            </span>
          )}
        </For>
      </p>
    </div>
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
  choice: ClaudeChoice | undefined;
  onName: (name: string) => void;
  onChoice: (choice: ClaudeChoice) => void;
  onStep: (step: SetupStepId) => void;
  onClose: () => void;
}) {
  const nameId = createUniqueId();
  const agents = useAgentsQuery();
  const renameBot = useUpdateBotMutation();
  const signOut = useClaudeSignOutMutation();
  const completeSetup = useCompleteComputerSetupMutation();
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

  const header = (): JSX.Element => (
    <div class="flex flex-col gap-3">
      <StepHeader
        step={props.step}
        skipsClaude={props.choice === 'macro_credits'}
      />
      <Show when={isProvisioning(props.computer)}>
        <ProvisioningBar computer={props.computer} />
      </Show>
    </div>
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
              {t('computers.signInLinkWaiting')}
            </ActionDialogShell.Description>
          </ActionDialogShell.Header>
          <p class="text-sm text-ink-muted">
            {t('computers.claudeSharedAccount')}
          </p>
        </ActionDialogShell.Body>
        <ActionDialogShell.Footer>
          <Button type="button" variant="ghost" onClick={useCreditsInstead}>
            {t('computers.claudeUseCreditsInstead')}
          </Button>
          <Button type="button" variant="primary" disabled>
            {t('computers.openClaudeSignIn')}
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
