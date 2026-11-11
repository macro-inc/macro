import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { enableMacroComputers } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { fireAndForget } from '@core/util/fireAndForget';
import { ThrownResultError } from '@core/util/result';
import HardDrivesIcon from '@icon/system/regular/hard-drives.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import { useAgentsQuery } from '@queries/agents/agents';
import {
  useClaudeModeQuery,
  useClaudeSignOutMutation,
} from '@queries/computers/claude';
import {
  useCancelComputerMutation,
  useComputerOffersQuery,
  useReleaseComputerMutation,
  useSetComputerPowerMutation,
  useUndoCancelComputerMutation,
} from '@queries/computers/computers';
import { useIsTeamAdmin, useIsTeamOwner } from '@queries/team/teams';
import type { ComputerStatus, SizeOffer } from '@service-auth/computers';
import type { Harness as RegisteredHarness } from '@service-storage/client';
import { Button, confirmDialog } from '@ui';
import { createSignal, For, Show, Suspense } from 'solid-js';
import {
  MachineRow,
  RuntimeShareDialog,
} from '../../components/connected-runtimes-section';
import { HarnessIcon } from '../../integration-ui';
import { IntegrationRow, SettingsCard } from '../../primitives';
import type { ComputerMenuItem } from '../components/computer-actions-menu';
import {
  type ComputerClaudeState,
  type ComputerPrimaryAction,
  ComputerRow,
} from '../components/computer-row';
import { ReleaseComputerDialog } from '../components/release-computer-dialog';
import {
  canTogglePower,
  formatComputerDate,
  formatQuote,
} from '../core/computer-display';
import { useTeamComputers } from '../primitives/team-computers';
import { ClaudeSignInDialog } from './claude-sign-in-dialog';
import { ComputerBuyFlow } from './computer-buy-flow';

function failureMessage(error: unknown, fallback: string): string {
  return (error instanceof ThrownResultError && error.message) || fallback;
}

/** The cheapest size on sale, for "From $20/month". */
export function cheapestOffer(
  offers: readonly SizeOffer[]
): SizeOffer | undefined {
  return offers
    .filter((offer) => !offer.soldOut)
    .reduce<SizeOffer | undefined>(
      (cheapest, offer) =>
        !cheapest || offer.quote.amount < cheapest.quote.amount
          ? offer
          : cheapest,
      undefined
    );
}

/**
 * A team's call to get a computer: one row like the others, with sizes and
 * prices in the picker it opens.
 */
export function GetComputerRow(props: {
  title: string;
  description: string;
  onGet: () => void;
  /** Padding to match the list it sits in. */
  class?: string;
}) {
  return (
    <IntegrationRow
      class={props.class}
      icon={
        <HarnessIcon>
          <HardDrivesIcon />
        </HarnessIcon>
      }
      title={props.title}
      facts={props.description}
    >
      <Button type="button" variant="secondary" size="sm" onClick={props.onGet}>
        {t('computers.getComputerAction')}
      </Button>
    </IntegrationRow>
  );
}

/** One computer's row, with its Claude state and the actions the viewer has. */
function ManagedComputerRow(props: {
  computer: ComputerStatus;
  harness?: RegisteredHarness;
  canManage: boolean;
  canManageClaude: boolean;
  /** The buyer or the team owner, whom the server lets finish setup. */
  canFinishSetup: boolean;
  onFinishSetup: () => void;
  onSignIn: () => void;
  onShare: () => void;
  onRelease: () => void;
}) {
  const rollout = useFeatureFlag(enableMacroComputers);
  const mode = useClaudeModeQuery(() =>
    rollout().enabled && props.canManageClaude
      ? (props.computer.harnessId ?? undefined)
      : undefined
  );
  const power = useSetComputerPowerMutation();
  const cancel = useCancelComputerMutation();
  const undoCancel = useUndoCancelComputerMutation();
  const signOut = useClaudeSignOutMutation();

  // The active login names the account; macrod's report says whether Claude
  // is still signed in to it.
  const account = () => {
    const claude = props.harness?.capabilities?.claude;
    if (claude?.status !== 'signed_in') return undefined;
    return mode.isSuccess
      ? (mode.data.account?.email ?? undefined)
      : claude.account;
  };
  const currentMode = () =>
    mode.isSuccess ? mode.data.mode : props.harness?.claude_mode;
  const claude = (): ComputerClaudeState => {
    // Guided setup picks Claude; until then there is nothing to show.
    if (!props.computer.setupCompletedAt) return { kind: 'unset' };
    const value = currentMode();
    if (value === 'macro_credits') return { kind: 'credits' };
    if (value === 'own_account')
      return { kind: 'account', account: account() ?? undefined };
    return { kind: 'loading' };
  };
  const setupIncomplete = () => !props.computer.setupCompletedAt;
  const claudeMissing = () => {
    const state = claude();
    return state.kind === 'account' && !state.account;
  };

  const primary = (): ComputerPrimaryAction | undefined => {
    if (props.computer.status === 'payment_failed') return undefined;
    if (setupIncomplete()) {
      if (!props.canFinishSetup) return undefined;
      return {
        label: t('computers.finishSetup'),
        onClick: props.onFinishSetup,
      };
    }
    if (props.canManageClaude && claudeMissing())
      return { label: t('computers.claudeSignIn'), onClick: props.onSignIn };
    return undefined;
  };

  const turnOff = async () => {
    const confirmed = await confirmDialog({
      title: t('computers.turnOffTitle', { name: props.computer.name }),
      body: t('computers.turnOffBody'),
      confirmLabel: t('computers.turnOff'),
      tone: 'danger',
    });
    if (confirmed) await setPower(false);
  };
  const setPower = async (on: boolean) => {
    try {
      await power.mutateAsync({ computerId: props.computer.id, on });
    } catch (error) {
      toast.failure(
        failureMessage(
          error,
          on ? t('computers.powerOnFailed') : t('computers.powerOffFailed')
        )
      );
    }
  };
  const switchToCredits = async () => {
    const harnessId = props.computer.harnessId;
    if (!harnessId) return;
    const confirmed = await confirmDialog({
      title: t('computers.switchToCreditsTitle', { name: props.computer.name }),
      body: t('computers.switchToCreditsBody', {
        account: account() ?? t('computers.claudeOwnChoice'),
      }),
      confirmLabel: t('computers.switchToCredits'),
    });
    if (!confirmed) return;
    try {
      await signOut.mutateAsync(harnessId);
    } catch {
      toast.failure(t('computers.claudeCreditsFailed'));
    }
  };
  const switchToAccount = async () => {
    const confirmed = await confirmDialog({
      title: t('computers.switchToAccountTitle', { name: props.computer.name }),
      body: t('computers.switchToAccountBody'),
      confirmLabel: t('computers.continueToSignIn'),
    });
    if (confirmed) props.onSignIn();
  };
  const cancelAtPeriodEnd = async () => {
    try {
      const updated = await cancel.mutateAsync(props.computer.id);
      toast.success(
        updated.cancelsAt
          ? t('computers.cancelOn', {
              name: props.computer.name,
              date: formatComputerDate(updated.cancelsAt),
            })
          : t('computers.cancelAtPeriodEnd', { name: props.computer.name })
      );
    } catch (error) {
      toast.failure(failureMessage(error, t('computers.cancelFailed')));
    }
  };
  const keep = async () => {
    try {
      await undoCancel.mutateAsync(props.computer.id);
      toast.success(t('computers.keeping', { name: props.computer.name }));
    } catch (error) {
      toast.failure(failureMessage(error, t('computers.keepFailed')));
    }
  };

  const run = (work: Promise<void>) => fireAndForget(work, 'macro-computers');
  const billingPending = () => cancel.isPending || undoCancel.isPending;

  const menu = (): ComputerMenuItem[] => {
    const items: ComputerMenuItem[] = [];
    const computer = props.computer;
    const paymentFailed = computer.status === 'payment_failed';
    if (props.canManage && !paymentFailed && canTogglePower(computer)) {
      items.push(
        computer.poweredOn
          ? {
              label: t('computers.turnOff'),
              icon: 'power',
              disabled: power.isPending,
              onSelect: () => run(turnOff()),
            }
          : {
              label: t('computers.turnOn'),
              icon: 'power',
              disabled: power.isPending,
              onSelect: () => run(setPower(true)),
            }
      );
    }
    if (props.canManageClaude && !paymentFailed && !setupIncomplete()) {
      const state = claude();
      if (state.kind === 'account')
        items.push({
          label: t('computers.switchToCredits'),
          icon: 'credits',
          onSelect: () => run(switchToCredits()),
        });
      if (state.kind === 'credits')
        items.push({
          label: t('computers.claudeSignIn'),
          icon: 'sign-in',
          onSelect: () => run(switchToAccount()),
        });
    }
    if (props.canManage && !paymentFailed && !computer.retainedUntil) {
      if (!computer.cancelsAt) {
        items.push({
          label: t('computers.cancelAtEnd'),
          icon: 'cancel',
          disabled: billingPending(),
          onSelect: () => run(cancelAtPeriodEnd()),
        });
      } else if (computer.canUndoCancel) {
        // Billing stops an hour before period end; after that it is final.
        items.push({
          label: t('computers.undoCancel'),
          icon: 'undo',
          disabled: billingPending(),
          onSelect: () => run(keep()),
        });
      }
    }
    if (props.canManage) {
      items.push({
        label: paymentFailed ? 'Remove' : t('computers.releaseNow'),
        icon: 'release',
        danger: true,
        onSelect: props.onRelease,
      });
    }
    return items;
  };

  return (
    <ComputerRow
      computer={props.computer}
      claude={claude()}
      primary={primary()}
      share={
        props.harness?.access === 'owner'
          ? {
              label: t('runtimeSharing.share'),
              icon: 'share',
              onSelect: props.onShare,
            }
          : undefined
      }
      menu={menu()}
      harness={props.harness?.access === 'owner' ? props.harness : undefined}
    />
  );
}

/**
 * The team's Macro computers on Settings → Machines: every member sees the
 * list; team admins also get the call to buy one and the power and billing
 * controls; whoever may manage a computer's Claude gets those.
 */
export function MacroComputers(props: {
  harnesses: readonly RegisteredHarness[];
  /** The runtime whose Share menu is open, e.g. from an access request. */
  sharing?: string;
  onSharingChange: (harnessId: string | undefined) => void;
}) {
  const isAdmin = useIsTeamAdmin();
  const isTeamOwner = useIsTeamOwner();
  const userId = useUserId();
  const { enabled, canPurchase, computers, failed } = useTeamComputers();
  const offers = useComputerOffersQuery(() => canPurchase() && isAdmin());
  const release = useReleaseComputerMutation();
  const agents = useAgentsQuery();

  const [buying, setBuying] = createSignal(false);
  const [settingUp, setSettingUp] = createSignal<string>();
  const [signingIn, setSigningIn] = createSignal<string>();
  const [releasing, setReleasing] = createSignal<ComputerStatus>();
  const [releaseError, setReleaseError] = createSignal<string>();

  const harnessFor = (computer: ComputerStatus) =>
    props.harnesses.find((candidate) => candidate.id === computer.harnessId);

  const canManageClaude = (computer: ComputerStatus) => {
    const harness = harnessFor(computer);
    const viewer = userId();
    if (!harness || !viewer) return false;
    if (harness.owner.type === 'user') return harness.owner.user_id === viewer;
    return harness.created_by === viewer || isTeamOwner();
  };

  const fromPriceLine = () => {
    const offer = offers.isSuccess ? cheapestOffer(offers.data) : undefined;
    if (!offer) return undefined;
    if (offer.quote.amount === 0) return t('computers.included');
    return t('computers.fromPriceLower', { price: formatQuote(offer.quote) });
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
          ? t('computers.removed', { name: computer.name })
          : t('computers.released', { name: computer.name })
      );
    } catch (error) {
      if (computer.status === 'payment_failed') {
        toast.failure(failureMessage(error, t('computers.removeFailed')));
        return;
      }
      setReleaseError(failureMessage(error, t('computers.releaseFailed')));
    }
  };

  const closeRelease = () => {
    if (release.isPending) return;
    setReleasing(undefined);
    setReleaseError(undefined);
  };

  // Releasing deletes every agent bound to the computer's runtime.
  const agentsOn = (computer: ComputerStatus) =>
    agents.isSuccess && computer.harnessId
      ? agents.data
          .filter((agent) => agent.harness_id === computer.harnessId)
          .map((agent) => agent.bot.name)
      : [];

  const byId = (id: string | undefined) =>
    computers().find((computer) => computer.id === id);

  return (
    <Show when={enabled()}>
      <Show
        when={
          computers().length > 0 || failed() || (canPurchase() && isAdmin())
        }
      >
        <div data-settings-target="macro-computer">
          <h2 class="mb-3 px-6 text-sm font-semibold text-ink">
            {t('computers.title')}
          </h2>
          <SettingsCard>
            <For each={computers()}>
              {(computer) => (
                <ManagedComputerRow
                  computer={computer}
                  harness={harnessFor(computer)}
                  canManage={isAdmin()}
                  canManageClaude={canManageClaude(computer)}
                  canFinishSetup={
                    computer.purchasedBy === userId() || isTeamOwner()
                  }
                  onFinishSetup={() => setSettingUp(computer.id)}
                  onSignIn={() => setSigningIn(computer.id)}
                  onShare={() =>
                    props.onSharingChange(computer.harnessId ?? undefined)
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
            <Show when={canPurchase() && isAdmin()}>
              <MachineRow
                name={t('computers.getComputer')}
                dot={<PlusIcon class="size-3 text-ink-muted" />}
                meta={[t('computers.getComputerLine'), fromPriceLine()]
                  .filter(Boolean)
                  .join(' · ')}
                actions={
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setBuying(true)}
                  >
                    {t('computers.getComputerAction')}
                  </Button>
                }
              />
            </Show>
            <Show when={failed()}>
              <p class="px-4 py-3 text-xs text-negative">
                {t('computers.loadFailed')}
              </p>
            </Show>
          </SettingsCard>
        </div>
      </Show>

      <ComputerBuyFlow open={buying()} onClose={() => setBuying(false)} />
      <ComputerBuyFlow
        open={!!settingUp()}
        computerId={settingUp()}
        onClose={() => setSettingUp(undefined)}
      />
      <Show when={byId(signingIn())?.harnessId}>
        {(harnessId) => (
          <ClaudeSignInDialog
            harnessId={harnessId()}
            onClose={() => setSigningIn(undefined)}
          />
        )}
      </Show>
      <Show
        when={props.harnesses.find(
          (harness) =>
            harness.id === props.sharing &&
            computers().some((computer) => computer.harnessId === harness.id)
        )}
      >
        {(harness) => (
          <Suspense>
            <RuntimeShareDialog
              harness={harness()}
              open
              onOpenChange={(open) => !open && props.onSharingChange(undefined)}
            />
          </Suspense>
        )}
      </Show>
      <Show when={releasing()} keyed>
        {(computer) => (
          <ReleaseComputerDialog
            computerName={computer.name}
            agentCount={computer.agentCount}
            agentNames={agentsOn(computer)}
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
