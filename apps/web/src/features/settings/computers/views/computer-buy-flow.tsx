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
import type {
  ComputerSize,
  ComputerStatus,
  SizeOffer,
} from '@service-auth/computers';
import { createSignal, Show } from 'solid-js';
import { ComputerPurchaseDialog } from '../components/computer-purchase-dialog';
import { useTeamComputers } from '../primitives/team-computers';
import { ComputerSetupDialog } from './computer-setup-dialog';

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
 * Buy → guided setup, from wherever a team can get a computer: Settings →
 * Machines, the Agents list, and an agent's Where it runs. `onFinished` gets
 * the new computer when its setup dialog closes, so a caller can select it.
 */
export function ComputerBuyFlow(props: {
  open: boolean;
  onClose: () => void;
  onFinished?: (computer: ComputerStatus) => void;
}) {
  const firstName = useViewerFirstName();
  const offers = useComputerOffersQuery(() => props.open);
  const { computers } = useTeamComputers();
  const purchase = usePurchaseComputerMutation();
  const notify = useNotifyComputerSizeMutation();
  const [error, setError] = createSignal<string>();
  const [settingUp, setSettingUp] = createSignal<string>();

  const purchased = () =>
    computers().find((computer) => computer.id === settingUp());

  const buy = async (offer: SizeOffer, name: string | undefined) => {
    setError(undefined);
    try {
      const result = await purchase.mutateAsync({ size: offer.size, name });
      props.onClose();
      setSettingUp(result.computerId);
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

  const closeSetup = (computer: ComputerStatus) => {
    setSettingUp(undefined);
    props.onFinished?.(computer);
  };

  return (
    <>
      <Show when={props.open && offers.isSuccess && offers.data}>
        {(offerList) => (
          <ComputerPurchaseDialog
            offers={offerList()}
            defaultName={defaultComputerName(firstName())}
            pending={purchase.isPending}
            notifyPending={notify.isPending ? notify.variables : undefined}
            error={error()}
            onClose={() => {
              setError(undefined);
              props.onClose();
            }}
            onNotify={(size) =>
              fireAndForget(requestNotify(size), 'macro-computers')
            }
            onConfirm={(offer, name) =>
              fireAndForget(buy(offer, name), 'macro-computers')
            }
          />
        )}
      </Show>
      <Show when={purchased()}>
        {(computer) => (
          <ComputerSetupDialog
            computer={computer()}
            firstName={firstName()}
            onClose={() => closeSetup(computer())}
          />
        )}
      </Show>
    </>
  );
}
