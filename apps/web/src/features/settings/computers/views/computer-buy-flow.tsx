import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { getDisplayNameParts, tryMacroId } from '@core/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { ThrownResultError } from '@core/util/result';
import {
  useComputerOffersQuery,
  useNotifyComputerSizeMutation,
  usePurchaseComputerMutation,
} from '@queries/computers/computers';
import { useHarnessesQuery } from '@queries/harnesses/harnesses';
import type {
  ComputerSize,
  ComputerStatus,
  SizeOffer,
} from '@service-auth/computers';
import { ActionDialogShell, Dialog } from '@ui';
import { createEffect, createSignal, on, Show } from 'solid-js';
import { ComputerPurchaseStep } from '../components/computer-purchase-dialog';
import { useTeamComputers } from '../primitives/team-computers';
import {
  type ClaudeChoice,
  ComputerSetupSteps,
  computerConnected,
  type SetupStepId,
  StepHeader,
} from './computer-setup-dialog';

function failureMessage(error: unknown, fallback: string): string {
  return (error instanceof ThrownResultError && error.message) || fallback;
}

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
 * Guided setup in one modal, from Buy to Try it: Computer · Agent · Claude ·
 * Ready. Opened from Settings → Machines, the Agents list and an agent's
 * Where it runs, or with `computerId` from a row's Finish setup.
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
  onClose: () => void;
  onFinished?: (computer: ComputerStatus) => void;
}) {
  const firstName = useViewerFirstName();
  const offers = useComputerOffersQuery(() => props.open && !props.computerId);
  const { computers } = useTeamComputers();
  const harnesses = useHarnessesQuery();
  const purchase = usePurchaseComputerMutation();
  const notify = useNotifyComputerSizeMutation();
  const [error, setError] = createSignal<string>();
  const [boughtId, setBoughtId] = createSignal<string>();
  const [step, setStep] = createSignal<SetupStepId>('computer');
  const [name, setName] = createSignal<string>();
  const [choice, setChoice] = createSignal<ClaudeChoice>();
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

  // Opening from Finish setup starts on the agent step.
  createEffect(
    on(
      () => props.open,
      (open) => {
        if (open && props.computerId && step() === 'computer') setStep('agent');
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
    const current = computer();
    props.onClose();
    if (current) props.onFinished?.(current);
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
        size: offer.size,
        name: computerName,
      });
      setBoughtId(result.computerId);
      setStep('agent');
      toast.success(t('computers.purchased'));
    } catch (failure) {
      setError(failureMessage(failure, t('computers.purchaseFailed')));
    }
  };

  const requestNotify = async (size: ComputerSize) => {
    try {
      await notify.mutateAsync(size);
    } catch (failure) {
      toast.failure(failureMessage(failure, t('computers.notifyFailed')));
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
              <Show when={offers.isSuccess && offers.data}>
                {(offerList) => (
                  <ComputerPurchaseStep
                    header={<StepHeader step="computer" skipsClaude={false} />}
                    offers={offerList()}
                    defaultName={defaultComputerName(firstName())}
                    pending={purchase.isPending}
                    notifyPending={
                      notify.isPending ? notify.variables : undefined
                    }
                    error={error()}
                    onClose={close}
                    onNotify={(size) =>
                      fireAndForget(requestNotify(size), 'macro-computers')
                    }
                    onConfirm={(offer, computerName) =>
                      fireAndForget(buy(offer, computerName), 'macro-computers')
                    }
                  />
                )}
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
              />
            )}
          </Show>
        </ActionDialogShell>
      </Dialog>
    </Show>
  );
}
