import { t } from '@app/lib/i18n';
import { useSettingsState } from '@core/constant/SettingsState';
import { useUserId } from '@core/context/user';
import { getDisplayNameParts, tryMacroId } from '@core/user';
import { fireAndForget } from '@core/util/fireAndForget';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import { useComputerOffersQuery } from '@queries/computers/computers';
import { useHarnessesQuery } from '@queries/harnesses/harnesses';
import { isTeamAgentComputer } from '@queries/harnesses/runnable';
import type { ClaudeMode } from '@service-agent-harness/generated/schemas';
import type { ComputerStatus, SizeOffer } from '@service-auth/computers';
import { ActionDialogShell, Button, Dialog } from '@ui';
import { createEffect, createSignal, on, onCleanup, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { ComputerPurchaseStep } from '../components/computer-purchase-dialog';
import {
  computerFailureMessage,
  offersFailure,
} from '../core/computer-display';
import { useBuyComputer } from '../primitives/buy-computer';
import {
  holdSetupNotices,
  showComputerSetupNotice,
} from '../primitives/setup-notice';
import { useTeamComputers } from '../primitives/team-computers';
import {
  ComputerSetupSteps,
  computerConnected,
  defaultAgentName,
  type SetupStepId,
  StepHeader,
} from './computer-setup-dialog';

/** The viewer's first name, for "Maya's Agent Box" and "Maya's Agent". */
export function useViewerFirstName() {
  const userId = useUserId();
  return () =>
    getDisplayNameParts(tryMacroId(userId() ?? '')).firstName || undefined;
}

/** "Maya's Agent Box", or "Agent Box" without a first name. */
function defaultComputerName(firstName: string | undefined): string {
  return firstName
    ? t('computers.defaultComputerName', { name: firstName })
    : t('computers.defaultComputerNameFallback');
}

/**
 * Setup resumed from a row's Finish setup, before the team's computer list
 * has the computer. The dialog can be closed meanwhile.
 */
function ResumingStep(props: {
  step: SetupStepId;
  steps: boolean;
  /** The agent Ready sets up, named while the stepless buy waits. */
  agentName: string;
  onClose: () => void;
}) {
  return (
    <>
      <ActionDialogShell.Body>
        <Show when={props.steps}>
          <StepHeader step={props.step} claude="step" />
        </Show>
        <ActionDialogShell.Header>
          <ActionDialogShell.Title>
            {props.steps
              ? t('computers.setupAgentTitle')
              : t('computers.settingUpAgentTitle', { agent: props.agentName })}
          </ActionDialogShell.Title>
        </ActionDialogShell.Header>
        <p role="status" class="flex items-center gap-2 text-sm text-ink-muted">
          <SpinnerIcon class="size-4 animate-spin" />
          {t('common.loading')}
        </p>
      </ActionDialogShell.Body>
      <ActionDialogShell.Footer>
        <Button type="button" variant="ghost" onClick={props.onClose}>
          {t('common.close')}
        </Button>
      </ActionDialogShell.Footer>
    </>
  );
}

/**
 * What Buy goes on to once the computer is bought: `ready`, in the same
 * dialog with no steps, finishes setup on Macro credits with the default
 * agent and ends on Chat with it (its own Claude account is brought later,
 * from the row); `guided` goes through Configure agent → Bring your AI →
 * Create agent.
 */
export type AfterPurchase = 'ready' | 'guided';

/**
 * Buy a computer, and with `afterPurchase="guided"`, its setup in one modal: Buy computer → Configure
 * agent → Bring your AI → Create agent. Opened from Settings → Machines, the Agents
 * list and an agent's Where it runs, or with `computerId` from a row's Finish
 * setup.
 *
 * It keeps its place when closed. Closed while waiting for the Claude
 * sign-in link, it toasts once the link is ready, and the toast reopens it on
 * that step. `onFinished` gets the computer when it closes, so a caller can
 * select it.
 */
export function ComputerBuyFlow(props: {
  open: boolean;
  /** Resume setup of this computer instead of buying one. */
  computerId?: string;
  /** Where resuming starts; Configure agent unless a link names a step. */
  resumeStep?: Exclude<SetupStepId, 'computer'>;
  onClose: () => void;
  onFinished?: (computer: ComputerStatus) => void;
  /** Opened from an agent's Where it runs, which `onFinished` updates. */
  selectsForAgent?: boolean;
  /** Where Buy goes once the computer is bought; `ready` unless given. */
  afterPurchase?: AfterPurchase;
}) {
  const afterPurchase = () => props.afterPurchase ?? 'ready';
  const guided = () => afterPurchase() === 'guided';
  const firstName = useViewerFirstName();
  const offers = useComputerOffersQuery(() => props.open && !props.computerId);
  const { computers } = useTeamComputers();
  const harnesses = useHarnessesQuery();
  const settings = useSettingsState();
  const [boughtId, setBoughtId] = createSignal<string>();
  const buyer = useBuyComputer({
    onBought: ({ computerId }) => {
      setBoughtId(computerId);
      match(afterPurchase())
        .with('guided', () => setStep('agent'))
        .with('ready', () => finishOnCredits())
        .exhaustive();
    },
  });
  const buying = () => buyer.state().kind === 'buying';
  const buyState = buyer.state;
  const [step, setStep] = createSignal<SetupStepId>('computer');
  const [name, setName] = createSignal<string>();
  const [choice, setChoice] = createSignal<ClaudeMode>();
  const [reopened, setReopened] = createSignal(false);
  const [waitingForLink, setWaitingForLink] = createSignal(false);
  // Choosing credits after opening the sign-in completes Bring your AI
  // rather than skipping it.
  const [signInVisited, setSignInVisited] = createSignal(false);
  createEffect(() => {
    if (step() === 'claude') setSignInVisited(true);
  });

  // No steps: the default agent on Macro credits, straight to Ready.
  const finishOnCredits = () => {
    setChoice('macro_credits');
    setStep('ready');
  };

  const computerId = () => props.computerId ?? boughtId();
  const computer = () => computers().find((item) => item.id === computerId());
  const connected = () => {
    const id = computer()?.harnessId;
    return harnesses.isSuccess
      ? harnesses.data.some((harness) => harness.id === id && harness.connected)
      : false;
  };
  const up = () => computerConnected(computer(), connected());
  // An agent teammate's computer runs only its agent: nothing to try or
  // create on it.
  const teamAgentComputer = () => {
    const id = computer()?.harnessId;
    return harnesses.isSuccess
      ? harnesses.data.some(
          (harness) => harness.id === id && isTeamAgentComputer(harness)
        )
      : false;
  };
  const visible = () => props.open || reopened();
  const setupStep = (): Exclude<SetupStepId, 'computer'> => {
    const current = step();
    return current === 'computer' ? 'agent' : current;
  };

  // Each step replaces the content, and with it the focused control; keep
  // focus in the modal so Escape and Tab still reach it.
  let content: HTMLDivElement | undefined;
  createEffect(
    on(step, () => {
      queueMicrotask(() => {
        if (content && !content.contains(document.activeElement))
          content.focus();
      });
    })
  );

  // Resuming starts where a setup link points (a link for another computer
  // than the one shown moves there too); otherwise on the agent step when
  // guided, or on Ready with the default agent on Macro credits.
  createEffect(
    on(
      () => [props.open, props.computerId, props.resumeStep] as const,
      ([open, computerId, resumeStep], previous) => {
        if (!open || !computerId) return;
        if (
          resumeStep &&
          (resumeStep !== previous?.[2] || computerId !== previous?.[1])
        ) {
          setStep(resumeStep);
          return;
        }
        if (step() !== 'computer') return;
        if (guided()) setStep('agent');
        else finishOnCredits();
      }
    )
  );

  const close = () => {
    if (buying()) return;
    setWaitingForLink(
      step() === 'claude' && choice() === 'own_account' && !up()
    );
    setReopened(false);
    const current = computer();
    props.onClose();
    if (current) props.onFinished?.(current);
  };

  const failureMessage = () => {
    const state = buyState();
    return state.kind === 'failed'
      ? computerFailureMessage(state.error, t('computers.purchaseFailed'))
      : undefined;
  };
  const noRoomSize = () => {
    const state = buyState();
    return state.kind === 'no_room' ? state.size : undefined;
  };

  // Billing is where a trial ends or a plan starts; the dialog is done.
  const openBilling = () => {
    close();
    settings.openSettings('Billing');
  };

  // The open dialog shows this computer's progress; no notice says it again.
  createEffect(() => {
    const id = computerId();
    if (visible() && id) onCleanup(holdSetupNotices(id));
  });

  // The link the user was waiting for is ready: say so, once.
  createEffect(() => {
    const current = computer();
    if (!waitingForLink() || visible() || !current || !up()) return;
    setWaitingForLink(false);
    // The same notice the computer's setup notification shows, so the two
    // never stack; this one reopens this dialog in place.
    fireAndForget(
      showComputerSetupNotice(
        {
          computerId: current.id,
          harnessId: current.harnessId ?? null,
          computerName: current.name,
          outcome: { kind: 'ready' },
        },
        () => {
          setStep('claude');
          setReopened(true);
        }
      ),
      'macro-computers'
    );
  });

  return (
    <Show when={visible()}>
      <Dialog
        open
        onOpenChange={(open) => !open && close()}
        position="center"
        visibleScrim
        contentRef={(element) => {
          content = element;
        }}
        class="w-[min(600px,calc(100vw-16px))]"
      >
        <ActionDialogShell class="h-auto">
          <Show
            when={step() !== 'computer' && computer()}
            fallback={
              <Show
                when={!computerId()}
                fallback={
                  // Resuming, or just bought: wait for the computer in the
                  // team's list, not for sizes.
                  <ResumingStep
                    step={setupStep()}
                    steps={guided()}
                    agentName={defaultAgentName(firstName())}
                    onClose={close}
                  />
                }
              >
                <ComputerPurchaseStep
                  header={
                    guided() ? (
                      <StepHeader step="computer" claude="step" />
                    ) : undefined
                  }
                  headsUp={guided() ? t('computers.buyHeadsUp') : undefined}
                  offers={offers.isSuccess ? offers.data : undefined}
                  failure={
                    offers.isError ? offersFailure(offers.error) : undefined
                  }
                  retrying={offers.isFetching}
                  defaultName={defaultComputerName(firstName())}
                  pending={buying()}
                  error={failureMessage()}
                  declined={buyState().kind === 'declined'}
                  noRoomSize={noRoomSize()}
                  onEdit={buyer.edit}
                  onClose={close}
                  onRetry={() =>
                    fireAndForget(offers.refetch(), 'macro-computers')
                  }
                  onBilling={openBilling}
                  onConfirm={(offer: SizeOffer, computerName) =>
                    fireAndForget(
                      buyer.buy(offer.size, computerName),
                      'macro-computers'
                    )
                  }
                />
              </Show>
            }
          >
            {(current) => (
              <ComputerSetupSteps
                computer={current()}
                connected={connected()}
                firstName={firstName()}
                step={setupStep()}
                name={name()}
                choice={choice()}
                onName={setName}
                onChoice={setChoice}
                onStep={setStep}
                onClose={close}
                steps={guided()}
                selectsForAgent={props.selectsForAgent}
                teamAgentComputer={teamAgentComputer()}
                signInVisited={signInVisited()}
              />
            )}
          </Show>
        </ActionDialogShell>
      </Dialog>
    </Show>
  );
}
