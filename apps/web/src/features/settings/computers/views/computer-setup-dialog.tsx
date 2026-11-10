import { createRecentAgentSelections } from '@app/features/block-agent/context/recent-agent-selections';
import { t } from '@app/lib/i18n';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import CheckCircleIcon from '@icon/system/regular/check-circle.svg';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import {
  type AgentWithHarnessId,
  invalidateAgents,
  useAgentsQuery,
} from '@queries/agents/agents';
import { useUpdateBotMutation } from '@queries/bots/bots';
import {
  useClaudeSignInMutation,
  useClaudeSignOutMutation,
} from '@queries/computers/claude';
import { useCompleteComputerSetupMutation } from '@queries/computers/computers';
import type { ComputerStatus, SetupStep } from '@service-auth/computers';
import { ActionDialogShell, Button, cn, Dialog, Input } from '@ui';
import {
  createEffect,
  createSignal,
  createUniqueId,
  For,
  Match,
  on,
  Show,
  Switch,
} from 'solid-js';
import { ChoiceRow } from '../../primitives';
import { isProvisioning, setupStepLabel } from '../core/computer-display';
import { ClaudeSignInFlow } from './claude-sign-in-flow';

type ClaudeChoice = 'own_account' | 'macro_credits';

const STEPS: readonly SetupStep[] = ['creating', 'booting', 'connecting'];

/** "Maya's Agent", or "Agent" for a viewer without a first name. */
export function defaultAgentName(firstName: string | undefined): string {
  return firstName
    ? t('computers.defaultAgentName', { name: firstName })
    : t('computers.defaultAgentNameFallback');
}

function ProvisioningProgress(props: { computer: ComputerStatus }) {
  const position = () =>
    isProvisioning(props.computer) ? (props.computer.setup?.position ?? 1) : 4;
  return (
    <ol class="flex flex-col gap-3" aria-label={t('computers.settingUp')}>
      <For each={STEPS}>
        {(step, index) => {
          const state = () => {
            if (index() + 1 < position()) return 'done';
            if (index() + 1 === position()) return 'active';
            return 'waiting';
          };
          return (
            <li
              class={cn(
                'flex items-center gap-3 text-sm',
                state() === 'waiting' ? 'text-ink-extra-muted' : 'text-ink'
              )}
              aria-current={state() === 'active' ? 'step' : undefined}
            >
              <span class="flex size-4 shrink-0 items-center justify-center">
                <Switch
                  fallback={
                    <span class="size-2 rounded-full bg-ink-extra-muted/40" />
                  }
                >
                  <Match when={state() === 'done'}>
                    <CheckCircleIcon class="size-4 text-success" />
                  </Match>
                  <Match when={state() === 'active'}>
                    <SpinnerIcon class="size-4 animate-spin text-accent" />
                  </Match>
                </Switch>
              </span>
              {setupStepLabel(step)}
            </li>
          );
        }}
      </For>
    </ol>
  );
}

/**
 * Guided setup after a purchase: provisioning progress, then the agent Macro
 * created on the computer (its name and which Claude it uses), then Try it.
 * Closing keeps everything done so far; the row's Finish setup resumes.
 */
export function ComputerSetupDialog(props: {
  computer: ComputerStatus;
  firstName?: string;
  onClose: () => void;
}) {
  const nameId = createUniqueId();
  const userId = useUserId();
  const agents = useAgentsQuery();
  const renameBot = useUpdateBotMutation();
  const signOut = useClaudeSignOutMutation();
  const preKick = useClaudeSignInMutation();
  const completeSetup = useCompleteComputerSetupMutation();
  const { replaceSplit } = useSplitLayout();
  const [step, setStep] = createSignal<'agent' | 'claude' | 'done'>('agent');
  const [name, setName] = createSignal<string>();
  const [choice, setChoice] = createSignal<ClaudeChoice>();
  const [error, setError] = createSignal<string>();
  const [account, setAccount] = createSignal<string>();

  const provisioning = () =>
    isProvisioning(props.computer) || !props.computer.harnessId;
  const agent = (): AgentWithHarnessId | undefined =>
    agents.isSuccess
      ? agents.data.find(
          (item) => item.bot.id === props.computer.defaultAgentId
        )
      : undefined;
  const agentName = () =>
    name() ?? agent()?.bot.name ?? defaultAgentName(props.firstName);
  const busy = () =>
    renameBot.isPending || signOut.isPending || completeSetup.isPending;

  // Start the Claude sign-in while the user names the agent, so its link is
  // ready the moment they choose their own account. Starting is idempotent.
  createEffect(
    on(
      () => props.computer.harnessId,
      (harnessId) => {
        if (!harnessId || provisioning()) return;
        fireAndForget(
          preKick
            .mutateAsync({ harnessId, signal: new AbortController().signal })
            .then(() => undefined),
          'computer-setup'
        );
      }
    )
  );

  const finish = async () => {
    await completeSetup.mutateAsync(props.computer.id);
    setStep('done');
  };

  const saveAgent = async () => {
    const current = agent();
    const harnessId = props.computer.harnessId;
    if (!current || !harnessId) return;
    setError(undefined);
    try {
      const trimmed = agentName().trim();
      if (trimmed && trimmed !== current.bot.name) {
        await renameBot.mutateAsync({ botId: current.bot.id, name: trimmed });
        await invalidateAgents();
      }
      if (choice() === 'own_account') {
        setStep('claude');
        return;
      }
      await signOut.mutateAsync(harnessId);
      await finish();
    } catch {
      setError(t('computers.setupFailed'));
    }
  };

  const useCreditsInstead = async () => {
    const harnessId = props.computer.harnessId;
    if (!harnessId) return;
    setChoice('macro_credits');
    setStep('agent');
    try {
      await signOut.mutateAsync(harnessId);
      await finish();
    } catch {
      setError(t('computers.setupFailed'));
    }
  };

  const tryIt = () => {
    const botId = props.computer.defaultAgentId;
    if (botId) createRecentAgentSelections(userId()).remember(botId);
    props.onClose();
    replaceSplit({ content: { type: 'component', id: 'agents' } });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !busy() && props.onClose()}
      position="center"
      visibleScrim
      class="w-[min(480px,calc(100vw-16px))]"
    >
      <ActionDialogShell class="h-auto">
        <Switch>
          <Match when={provisioning()}>
            <ActionDialogShell.Body>
              <ActionDialogShell.Header>
                <ActionDialogShell.Title>
                  {t('computers.setupProvisioningTitle')}
                </ActionDialogShell.Title>
                <ActionDialogShell.Description>
                  {t('computers.setupProvisioningBody')}
                </ActionDialogShell.Description>
              </ActionDialogShell.Header>
              <ProvisioningProgress computer={props.computer} />
            </ActionDialogShell.Body>
            <ActionDialogShell.Footer>
              <Button type="button" variant="ghost" onClick={props.onClose}>
                {t('common.close')}
              </Button>
            </ActionDialogShell.Footer>
          </Match>
          <Match when={step() === 'claude' && props.computer.harnessId}>
            {(harnessId) => (
              <ClaudeSignInFlow
                harnessId={harnessId()}
                onSignedIn={(signedIn) => {
                  setAccount(signedIn);
                  fireAndForget(finish(), 'computer-setup');
                }}
                onUseCredits={() =>
                  fireAndForget(useCreditsInstead(), 'computer-setup')
                }
              />
            )}
          </Match>
          <Match when={step() === 'done'}>
            <ActionDialogShell.Body>
              <ActionDialogShell.Header>
                <ActionDialogShell.Title>
                  {t('computers.setupDoneTitle', { agent: agentName() })}
                </ActionDialogShell.Title>
                <ActionDialogShell.Description>
                  {t('computers.setupDoneBody', {
                    computer: props.computer.name,
                  })}
                </ActionDialogShell.Description>
              </ActionDialogShell.Header>
              <Show when={account()}>
                {(connected) => (
                  <p class="text-sm text-ink-muted">
                    {t('computers.claudeConnectedAs', {
                      account: connected(),
                    })}
                  </p>
                )}
              </Show>
            </ActionDialogShell.Body>
            <ActionDialogShell.Footer>
              <Button type="button" variant="ghost" onClick={props.onClose}>
                {t('computers.done')}
              </Button>
              <Button type="button" variant="primary" onClick={tryIt}>
                {t('computers.tryIt')}
              </Button>
            </ActionDialogShell.Footer>
          </Match>
          <Match when={step() === 'agent'}>
            <ActionDialogShell.Body>
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
                  disabled={busy()}
                  onInput={(event) => setName(event.currentTarget.value)}
                />
              </div>
              <fieldset class="flex flex-col gap-2">
                <legend class="mb-2 text-sm leading-5 text-ink-muted">
                  {t('computers.claudeChoice')}
                </legend>
                <ChoiceRow
                  name="computer-claude-choice"
                  value="own_account"
                  checked={choice() === 'own_account'}
                  title={t('computers.claudeOwnChoice')}
                  description={t('computers.claudeOwnChoiceHint')}
                  onChange={() => setChoice('own_account')}
                />
                <ChoiceRow
                  name="computer-claude-choice"
                  value="macro_credits"
                  checked={choice() === 'macro_credits'}
                  title={t('computers.claudeCreditsChoice')}
                  description={t('computers.claudeCreditsChoiceHint')}
                  onChange={() => setChoice('macro_credits')}
                />
              </fieldset>
              <Show when={error()}>
                {(message) => (
                  <p role="alert" class="text-sm text-failure">
                    {message()}
                  </p>
                )}
              </Show>
            </ActionDialogShell.Body>
            <ActionDialogShell.Footer>
              <Button
                type="button"
                variant="ghost"
                disabled={busy()}
                onClick={props.onClose}
              >
                {t('common.close')}
              </Button>
              <Button
                type="button"
                variant="primary"
                disabled={
                  busy() || !choice() || !agent() || !agentName().trim()
                }
                onClick={() => fireAndForget(saveAgent(), 'computer-setup')}
              >
                {t('computers.continue')}
              </Button>
            </ActionDialogShell.Footer>
          </Match>
        </Switch>
      </ActionDialogShell>
    </Dialog>
  );
}
