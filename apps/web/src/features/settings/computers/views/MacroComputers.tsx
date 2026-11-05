import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { ThrownResultError } from '@core/util/result';
import {
  useCancelComputerMutation,
  useComputerOffersQuery,
  useNotifyComputerSizeMutation,
  usePurchaseComputerMutation,
  useReleaseComputerMutation,
  useSetComputerPowerMutation,
  useUndoCancelComputerMutation,
} from '@queries/computers/computers';
import { useIsTeamAdmin, useIsTeamOwner } from '@queries/team/teams';
import type {
  ComputerSize,
  ComputerStatus,
  SizeOffer,
} from '@service-auth/computers';
import type { Harness as RegisteredHarness } from '@service-storage/generated/schemas/harness';
import { Button } from '@ui';
import { createSignal, For, Match, Show, Switch } from 'solid-js';
import { SettingsCard } from '../../primitives';
import { ComputerPurchaseDialog } from '../components/computer-purchase-dialog';
import { ComputerRow, type ComputerRuntime } from '../components/computer-row';
import { ComputerSizePicker } from '../components/computer-size-picker';
import { ReleaseComputerDialog } from '../components/release-computer-dialog';
import { formatComputerDate } from '../core/computer-display';
import { useTeamComputers } from '../primitives/team-computers';
import { ComputerClaudeAccess } from './computer-claude-access';

function failureMessage(error: unknown, fallback: string): string {
  return (error instanceof ThrownResultError && error.message) || fallback;
}

/**
 * The team's Macro computers on Settings → Runtimes: every member sees the
 * list, and team admins also get the purchase card and the controls.
 */
export function MacroComputers(props: {
  harnesses: readonly RegisteredHarness[];
}) {
  const isAdmin = useIsTeamAdmin();
  const isTeamOwner = useIsTeamOwner();
  const userId = useUserId();
  const { enabled, computers, failed } = useTeamComputers();
  const offers = useComputerOffersQuery(() => enabled() && isAdmin());
  const purchase = usePurchaseComputerMutation();
  const notify = useNotifyComputerSizeMutation();
  const power = useSetComputerPowerMutation();
  const cancel = useCancelComputerMutation();
  const undoCancel = useUndoCancelComputerMutation();
  const release = useReleaseComputerMutation();

  const [selectedSize, setSelectedSize] = createSignal<ComputerSize>();
  const [confirming, setConfirming] = createSignal<SizeOffer>();
  const [purchaseError, setPurchaseError] = createSignal<string>();
  const [releasing, setReleasing] = createSignal<ComputerStatus>();
  const [releaseError, setReleaseError] = createSignal<string>();

  const offerList = () => (offers.isSuccess ? offers.data : []);
  const selectedOffer = () =>
    offerList().find(
      (offer) => offer.size === selectedSize() && !offer.soldOut
    );

  const runtimeFor = (
    computer: ComputerStatus
  ): ComputerRuntime | undefined => {
    const harness = props.harnesses.find(
      (candidate) => candidate.id === computer.harnessId
    );
    return harness
      ? {
          name: harness.name,
          connected: harness.connected,
          claudeMode: harness.claude_mode,
        }
      : undefined;
  };

  const canManageClaude = (computer: ComputerStatus) => {
    const harness = props.harnesses.find(
      (item) => item.id === computer.harnessId
    );
    const viewer = userId();
    if (!harness || !viewer) return false;
    if (harness.owner.type === 'user') return harness.owner.user_id === viewer;
    return harness.created_by === viewer || isTeamOwner();
  };

  const openConfirm = () => {
    const offer = selectedOffer();
    if (!offer) return;
    setPurchaseError(undefined);
    setConfirming(offer);
  };

  const closeConfirm = () => {
    setConfirming(undefined);
    setPurchaseError(undefined);
  };

  const buy = async (offer: SizeOffer, name: string | undefined) => {
    setPurchaseError(undefined);
    try {
      await purchase.mutateAsync({ size: offer.size, name });
      closeConfirm();
      setSelectedSize(undefined);
      toast.success('Computer purchased. Setting it up now.');
    } catch (error) {
      setPurchaseError(
        failureMessage(error, "Couldn't buy the computer. Please try again.")
      );
    }
  };

  const requestNotify = async (size: ComputerSize) => {
    try {
      await notify.mutateAsync(size);
    } catch (error) {
      toast.failure(failureMessage(error, "Couldn't save your request."));
    }
  };

  const setPower = async (computer: ComputerStatus, on: boolean) => {
    try {
      await power.mutateAsync({ computerId: computer.id, on });
    } catch (error) {
      toast.failure(
        failureMessage(
          error,
          on ? "Couldn't turn the computer on." : "Couldn't turn it off."
        )
      );
    }
  };

  const cancelAtPeriodEnd = async (computer: ComputerStatus) => {
    try {
      const updated = await cancel.mutateAsync(computer.id);
      toast.success(
        updated.cancelsAt
          ? `${computer.name} cancels on ${formatComputerDate(updated.cancelsAt)}.`
          : `${computer.name} cancels at the end of this billing period.`
      );
    } catch (error) {
      toast.failure(failureMessage(error, "Couldn't cancel the computer."));
    }
  };

  const keep = async (computer: ComputerStatus) => {
    try {
      await undoCancel.mutateAsync(computer.id);
      toast.success(`Keeping ${computer.name}.`);
    } catch (error) {
      toast.failure(failureMessage(error, "Couldn't keep the computer."));
    }
  };

  const releaseNow = async (computer: ComputerStatus) => {
    setReleaseError(undefined);
    try {
      await release.mutateAsync({
        computerId: computer.id,
        confirmName: computer.name,
      });
      setReleasing(undefined);
      toast.success(
        computer.status === 'payment_failed'
          ? `${computer.name} removed`
          : `${computer.name} released`
      );
    } catch (error) {
      if (computer.status === 'payment_failed') {
        toast.failure(
          failureMessage(error, "Couldn't remove the computer. Try again.")
        );
        return;
      }
      setReleaseError(
        failureMessage(error, "Couldn't release the computer. Try again.")
      );
    }
  };

  const closeRelease = () => {
    if (release.isPending) return;
    setReleasing(undefined);
    setReleaseError(undefined);
  };

  const billingPending = () =>
    cancel.isPending || undoCancel.isPending || release.isPending;

  return (
    <Show when={enabled()}>
      <Show when={computers().length > 0 || failed()}>
        <div>
          <h2 class="mb-3 px-6 text-sm font-semibold text-ink">
            Macro computers
          </h2>
          <SettingsCard>
            <For each={computers()}>
              {(computer) => (
                <ComputerRow
                  computer={computer}
                  runtime={runtimeFor(computer)}
                  claudeAccess={
                    <Show when={computer.harnessId}>
                      {(harnessId) => (
                        <ComputerClaudeAccess
                          harnessId={harnessId()}
                          canManage={canManageClaude(computer)}
                          mode={runtimeFor(computer)?.claudeMode}
                        />
                      )}
                    </Show>
                  }
                  canManage={isAdmin()}
                  powerPending={
                    power.isPending &&
                    power.variables?.computerId === computer.id
                  }
                  billingPending={billingPending()}
                  onPower={(on) =>
                    fireAndForget(setPower(computer, on), 'macro-computers')
                  }
                  onCancel={() =>
                    fireAndForget(
                      cancelAtPeriodEnd(computer),
                      'macro-computers'
                    )
                  }
                  onKeep={() =>
                    fireAndForget(keep(computer), 'macro-computers')
                  }
                  onRelease={() => {
                    if (computer.status === 'payment_failed') {
                      fireAndForget(releaseNow(computer), 'macro-computers');
                      return;
                    }
                    setReleaseError(undefined);
                    setReleasing(computer);
                  }}
                />
              )}
            </For>
            <Show when={failed()}>
              <p class="px-4 py-3 text-xs text-negative">
                Could not load your team's computers. Try refreshing this page.
              </p>
            </Show>
          </SettingsCard>
        </div>
      </Show>

      <Show when={isAdmin()}>
        <div data-settings-target="macro-computer">
          <h2 class="mb-3 px-6 text-sm font-semibold text-ink">
            Get a Macro computer
          </h2>
          <SettingsCard>
            <section class="flex flex-col gap-4 px-6 py-5 mobile:px-4">
              <p class="text-sm text-ink-muted">
                A cloud machine for your team's agents, with macrod, Claude
                Code, a browser, and Docker ready to go. It sleeps when idle and
                wakes when an agent gets a prompt. Billed on your team
                subscription.
              </p>
              <Switch>
                <Match when={offers.isPending}>
                  <p class="text-xs text-ink-muted">Loading sizes…</p>
                </Match>
                <Match when={offers.isError}>
                  <p class="text-xs text-negative">
                    Could not load computer sizes. Try refreshing this page.
                  </p>
                </Match>
                <Match when={offers.isSuccess}>
                  <ComputerSizePicker
                    offers={offerList()}
                    selected={selectedSize()}
                    notifyPending={
                      notify.isPending ? notify.variables : undefined
                    }
                    onSelect={setSelectedSize}
                    onNotify={(size) =>
                      fireAndForget(requestNotify(size), 'macro-computers')
                    }
                  />
                  <div class="flex justify-end">
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      disabled={!selectedOffer()}
                      onClick={openConfirm}
                    >
                      Continue
                    </Button>
                  </div>
                </Match>
              </Switch>
            </section>
          </SettingsCard>
        </div>
      </Show>

      <Show when={confirming()} keyed>
        {(offer) => (
          <ComputerPurchaseDialog
            offer={offer}
            pending={purchase.isPending}
            error={purchaseError()}
            onClose={closeConfirm}
            onConfirm={(name) =>
              fireAndForget(buy(offer, name), 'macro-computers')
            }
          />
        )}
      </Show>
      <Show when={releasing()} keyed>
        {(computer) => (
          <ReleaseComputerDialog
            computerName={computer.name}
            pending={release.isPending}
            error={releaseError()}
            onClose={closeRelease}
            onRelease={() =>
              fireAndForget(releaseNow(computer), 'macro-computers')
            }
          />
        )}
      </Show>
    </Show>
  );
}
