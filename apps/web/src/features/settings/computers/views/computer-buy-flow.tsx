import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { useSettingsState } from '@core/constant/SettingsState';
import { useUserId } from '@core/context/user';
import { getDisplayNameParts, tryMacroId } from '@core/user';
import { fireAndForget } from '@core/util/fireAndForget';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import {
  useComputerOffersQuery,
  usePurchaseComputerMutation,
} from '@queries/computers/computers';
import { useHarnessesQuery } from '@queries/harnesses/harnesses';
import type { ClaudeMode } from '@service-agent-harness/generated/schemas';
import type { ComputerStatus, SizeOffer } from '@service-auth/computers';
import { ActionDialogShell, Button, Dialog } from '@ui';
import { createEffect, createSignal, on, Show } from 'solid-js';
import { ComputerPurchaseStep } from '../components/computer-purchase-dialog';
import {
  computerFailureMessage,
  offersFailure,
} from '../core/computer-display';
import { useTeamComputers } from '../primitives/team-computers';
import {
  ComputerSetupSteps,
  computerConnected,
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
function ResumingStep(props: { step: SetupStepId; onClose: () => void }) {
  return (
    <>
      <ActionDialogShell.Body>
        <StepHeader step={props.step} skipsClaude={false} />
        <ActionDialogShell.Header>
          <ActionDialogShell.Title>
            {t('computers.setupAgentTitle')}
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
 * Guided setup in one modal, from Buy to Try it: Buy computer → Configure
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
}) {
  const firstName = useViewerFirstName();
  const offers = useComputerOffersQuery(() => props.open && !props.computerId);
  const { computers } = useTeamComputers();
  const harnesses = useHarnessesQuery();
  const purchase = usePurchaseComputerMutation();
  const settings = useSettingsState();
  const [error, setError] = createSignal<string>();
  // One key per Buy dialog, sent again on every retry, so a retried Buy
  // never charges twice. An error means nothing was charged.
  const [purchaseKey, setPurchaseKey] = createSignal(crypto.randomUUID());
  const [boughtId, setBoughtId] = createSignal<string>();
  const [step, setStep] = createSignal<SetupStepId>('computer');
  const [name, setName] = createSignal<string>();
  const [choice, setChoice] = createSignal<ClaudeMode>();
  const [reopened, setReopened] = createSignal(false);
  const [waitingForLink, setWaitingForLink] = createSignal(false);

  const computerId = () => props.computerId ?? boughtId();
  const computer = () => computers().find((item) => item.id === computerId());
  const connected = () => {
    const id = computer()?.harnessId;
    return harnesses.isSuccess
      ? harnesses.data.some((harness) => harness.id === id && harness.connected)
      : false;
  };
  const up = () => computerConnected(computer(), connected());
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

  // Resuming starts on the agent step, or where a setup link points; a
  // link for another computer than the one shown moves there too.
  createEffect(
    on(
      () => [props.open, props.computerId, props.resumeStep] as const,
      ([open, computerId, resumeStep], previous) => {
        if (!open || !computerId) return;
        if (
          resumeStep &&
          (resumeStep !== previous?.[2] || computerId !== previous?.[1])
        )
          setStep(resumeStep);
        else if (step() === 'computer') setStep('agent');
      }
    )
  );

  const close = () => {
    if (purchase.isPending) return;
    setWaitingForLink(
      step() === 'claude' && choice() === 'own_account' && !up()
    );
    setReopened(false);
    setError(undefined);
    setPurchaseKey(crypto.randomUUID());
    const current = computer();
    props.onClose();
    if (current) props.onFinished?.(current);
  };

  // Billing is where a trial ends or a plan starts; the dialog is done.
  const openBilling = () => {
    close();
    settings.openSettings('Billing');
  };

  // The link the user was waiting for is ready: say so, once.
  createEffect(() => {
    const current = computer();
    if (!waitingForLink() || visible() || !current || !up()) return;
    setWaitingForLink(false);
    toast.success(t('computers.signInReadyToast', { name: current.name }), {
      // Long enough for someone who switched tabs to come back to it.
      duration: 60_000,
      actions: [
        {
          label: t('computers.signInReadyAction'),
          variant: 'primary',
          onClick: () => {
            setStep('claude');
            setReopened(true);
          },
        },
      ],
    });
  });

  const buy = async (offer: SizeOffer, computerName: string | undefined) => {
    setError(undefined);
    try {
      const result = await purchase.mutateAsync({
        purchaseKey: purchaseKey(),
        size: offer.size,
        name: computerName,
      });
      setBoughtId(result.computerId);
      setStep('agent');
      // Confirming is a success too: the computer shows as purchasing
      // until its charge is confirmed.
      toast.success(
        result.state === 'confirming'
          ? t('computers.purchaseConfirming')
          : t('computers.purchased')
      );
    } catch (failure) {
      setError(computerFailureMessage(failure, t('computers.purchaseFailed')));
    }
  };

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
                when={!props.computerId}
                fallback={
                  // Resuming setup waits for the computer, not for sizes.
                  <ResumingStep step={setupStep()} onClose={close} />
                }
              >
                <ComputerPurchaseStep
                  header={<StepHeader step="computer" skipsClaude={false} />}
                  offers={offers.isSuccess ? offers.data : undefined}
                  failure={
                    offers.isError ? offersFailure(offers.error) : undefined
                  }
                  retrying={offers.isFetching}
                  defaultName={defaultComputerName(firstName())}
                  pending={purchase.isPending}
                  error={error()}
                  onClose={close}
                  onRetry={() =>
                    fireAndForget(offers.refetch(), 'macro-computers')
                  }
                  onBilling={openBilling}
                  onConfirm={(offer, computerName) =>
                    fireAndForget(buy(offer, computerName), 'macro-computers')
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
                selectsForAgent={props.selectsForAgent}
              />
            )}
          </Show>
        </ActionDialogShell>
      </Dialog>
    </Show>
  );
}
