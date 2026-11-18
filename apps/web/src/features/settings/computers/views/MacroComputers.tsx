import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { enableMacroComputers } from '@core/constant/featureFlags';
import { fireAndForget } from '@core/util/fireAndForget';
import HardDrivesIcon from '@icon/system/regular/hard-drives.svg';
import { useAgentsQuery } from '@queries/agents/agents';
import {
  useClaudeModeQuery,
  useClaudeSignOutMutation,
} from '@queries/computers/claude';
import {
  useCancelComputerMutation,
  useReleaseComputerMutation,
  useRestoreComputerMutation,
  useRetryComputerMutation,
  useSetComputerPowerMutation,
  useUndoCancelComputerMutation,
} from '@queries/computers/computers';
import { useIsTeamAdmin } from '@queries/team/teams';
import type { ComputerStatus, SizeOffer } from '@service-auth/computers';
import type { Harness as RegisteredHarness } from '@service-storage/client';
import { Button, confirmDialog } from '@ui';
import { createEffect, createSignal, For, on, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { MachineCardError } from '../../components/connected-runtimes-section';
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
  computerFailureMessage,
  formatComputerDate,
  formatQuote,
  type OffersFailure,
  offersFailure,
} from '../core/computer-display';
import {
  computerSetupRequest,
  consumeComputerSetupRequest,
} from '../primitives/setup-request';
import { useTeamComputers } from '../primitives/team-computers';
import { ClaudeSignInDialog } from './claude-sign-in-dialog';
import { ComputerBuyFlow } from './computer-buy-flow';
import type { SetupStepId } from './computer-setup-dialog';

/**
 * The offers failed for a reason Billing settles: a trial, or no paid plan.
 * The buy row says so instead of offering a dialog that would say the same.
 */
export function offersBlockedByPlan(offers: {
  isError: boolean;
  error: unknown;
}): OffersFailure | undefined {
  if (!offers.isError) return undefined;
  const failure = offersFailure(offers.error);
  return failure.remedy === 'billing' ? failure : undefined;
}

/**
 * "From $20/month" (or "from $20/month" mid-line) for the cheapest size on
 * sale; "Included" when the team's computers are comped.
 */
export function fromPriceText(
  offers: readonly SizeOffer[] | undefined,
  placement: 'leading' | 'inline'
): string | undefined {
  const offer = offers ? cheapestOffer(offers) : undefined;
  if (!offer) return undefined;
  if (offer.quote.amount === 0) return t('computers.included');
  const price = formatQuote(offer.quote);
  return placement === 'leading'
    ? t('computers.fromPrice', { price })
    : t('computers.fromPriceLower', { price });
}

/** The cheapest size on sale. */
function cheapestOffer(offers: readonly SizeOffer[]): SizeOffer | undefined {
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
  /** A team owner or admin, whom the server lets finish setup. */
  canFinishSetup: boolean;
  onFinishSetup: () => void;
  onSignIn: () => void;
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
  const restore = useRestoreComputerMutation();
  const retry = useRetryComputerMutation();
  const signOut = useClaudeSignOutMutation();

  // Claude's long-lived credential names no account; it only expires.
  const expired = () => {
    const expiresAt = mode.isSuccess ? mode.data.account?.expiresAt : undefined;
    return expiresAt ? new Date(expiresAt).getTime() <= Date.now() : false;
  };
  const currentMode = () =>
    mode.isSuccess ? mode.data.mode : props.harness?.claude_mode;
  const claude = (): ComputerClaudeState => {
    // Guided setup picks Claude; until then there is nothing to show.
    if (!props.computer.setupCompletedAt) return { kind: 'unset' };
    const value = currentMode();
    if (value === 'macro_credits') return { kind: 'credits' };
    if (value === 'own_account') return { kind: 'account', expired: expired() };
    return { kind: 'loading' };
  };
  const setupIncomplete = () => !props.computer.setupCompletedAt;
  const claudeMissing = () => {
    const state = claude();
    return state.kind === 'account' && state.expired;
  };

  const failed = () => props.computer.status === 'failed';
  const primary = (): ComputerPrimaryAction | undefined => {
    // A failed setup only moves again once it is retried.
    if (failed() && props.canManage)
      return {
        label: t('computers.retrySetup'),
        disabled: retry.isPending,
        onClick: () => run(retrySetup()),
      };
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
        computerFailureMessage(
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
      body: t('computers.switchToCreditsBody'),
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
      toast.failure(computerFailureMessage(error, t('computers.cancelFailed')));
    }
  };
  const keep = async () => {
    try {
      await undoCancel.mutateAsync(props.computer.id);
      toast.success(t('computers.keeping', { name: props.computer.name }));
    } catch (error) {
      toast.failure(computerFailureMessage(error, t('computers.keepFailed')));
    }
  };

  const restoreBilling = async () => {
    const confirmed = await confirmDialog({
      title: t('computers.restoreTitle', { name: props.computer.name }),
      body: props.computer.compReason
        ? t('computers.restoreBodyComped')
        : t('computers.restoreBody'),
      confirmLabel: t('computers.restore'),
    });
    if (!confirmed) return;
    try {
      await restore.mutateAsync(props.computer.id);
      toast.success(t('computers.restored', { name: props.computer.name }));
    } catch (error) {
      toast.failure(
        computerFailureMessage(error, t('computers.restoreFailed'))
      );
    }
  };

  const retrySetup = async () => {
    try {
      await retry.mutateAsync(props.computer.id);
    } catch (error) {
      toast.failure(computerFailureMessage(error, t('computers.retryFailed')));
    }
  };

  const run = (work: Promise<void>) => fireAndForget(work, 'macro-computers');
  const billingPending = () =>
    cancel.isPending || undoCancel.isPending || restore.isPending;

  // Cancel, release and power wait until a purchase is confirmed.
  const billingItem = (): ComputerMenuItem | undefined =>
    match(props.computer.billing)
      .returnType<ComputerMenuItem | undefined>()
      .with('active', 'past_due', 'comped', () => ({
        label: t('computers.cancelAtEnd'),
        icon: 'cancel',
        disabled: billingPending(),
        onSelect: () => run(cancelAtPeriodEnd()),
      }))
      .with('ending', () =>
        props.computer.canUndoCancel
          ? {
              label: t('computers.undoCancel'),
              icon: 'undo',
              disabled: billingPending(),
              onSelect: () => run(keep()),
            }
          : undefined
      )
      .with('ended', () =>
        props.computer.canRestore
          ? {
              label: t('computers.restore'),
              icon: 'undo',
              disabled: billingPending(),
              onSelect: () => run(restoreBilling()),
            }
          : undefined
      )
      .with('purchasing', null, undefined, () => undefined)
      .exhaustive(() => undefined);

  const menu = (): ComputerMenuItem[] => {
    const items: ComputerMenuItem[] = [];
    const computer = props.computer;
    // Once billing has ended it only turns back on after a Restore.
    const canPower =
      canTogglePower(computer) &&
      (computer.poweredOn || computer.billing !== 'ended');
    // Retry setup is the row's action; the menu keeps the rest.
    if (props.canManage && computer.status === 'failed' && !primary()) {
      items.push({
        label: t('computers.retry'),
        icon: 'retry',
        disabled: retry.isPending,
        onSelect: () => run(retrySetup()),
      });
    }
    if (props.canManage && canPower) {
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
    if (props.canManageClaude && !setupIncomplete()) {
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
    const billing = billingItem();
    if (props.canManage && billing) items.push(billing);
    if (props.canManage && computer.status !== 'purchasing') {
      items.push({
        label: t('computers.releaseNow'),
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
  /** Get a computer, at the top of Machines, opened the buy flow. */
  buying: boolean;
  onBuyingChange: (buying: boolean) => void;
}) {
  const isAdmin = useIsTeamAdmin();
  const { enabled, computers, failed } = useTeamComputers();
  const release = useReleaseComputerMutation();
  const agents = useAgentsQuery();
  const buying = () => props.buying;
  const setBuying = (value: boolean) => props.onBuyingChange(value);
  const [settingUp, setSettingUp] = createSignal<string>();
  // Set when a setup notification reopens the flow: it lands on Bring your AI.
  const [resumeAt, setResumeAt] =
    createSignal<Exclude<SetupStepId, 'computer'>>();
  const [signingIn, setSigningIn] = createSignal<string>();
  const [releasing, setReleasing] = createSignal<ComputerStatus>();
  const [releaseError, setReleaseError] = createSignal<string>();

  // A setup notification, or its link opened cold, names the computer.
  createEffect(
    on(computerSetupRequest, (request) => {
      if (!request) return;
      setBuying(false);
      setResumeAt('claude');
      setSettingUp(request.computerId);
      consumeComputerSetupRequest(request.id);
    })
  );

  const harnessFor = (computer: ComputerStatus) =>
    props.harnesses.find((candidate) => candidate.id === computer.harnessId);

  // The computer's team owner and admins own its harness, not its buyer.
  const canManageClaude = (computer: ComputerStatus) =>
    harnessFor(computer)?.access === 'owner';

  const releaseNow = async (computer: ComputerStatus, typedName: string) => {
    setReleaseError(undefined);
    try {
      await release.mutateAsync({
        computerId: computer.id,
        confirmName: typedName,
      });
      setReleasing(undefined);
      toast.success(t('computers.released', { name: computer.name }));
    } catch (error) {
      setReleaseError(
        computerFailureMessage(error, t('computers.releaseFailed'))
      );
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
      <Show when={computers().length > 0 || failed()}>
        <div data-settings-target="macro-computer">
          <h2 class="mb-3 px-6 text-sm font-semibold text-ink">
            {t('computers.title')}
          </h2>
          <SettingsCard inset="wide">
            <For each={computers()}>
              {(computer) => (
                <ManagedComputerRow
                  computer={computer}
                  harness={harnessFor(computer)}
                  canManage={isAdmin()}
                  canManageClaude={canManageClaude(computer)}
                  canFinishSetup={isAdmin()}
                  onFinishSetup={() => {
                    setResumeAt(undefined);
                    setSettingUp(computer.id);
                  }}
                  onSignIn={() => setSigningIn(computer.id)}
                  onRelease={() => {
                    setReleaseError(undefined);
                    setReleasing(computer);
                  }}
                />
              )}
            </For>
            <Show when={failed()}>
              <MachineCardError>{t('computers.loadFailed')}</MachineCardError>
            </Show>
          </SettingsCard>
        </div>
      </Show>

      {/* One dialog for buying and for Finish setup, so a computer bought
          here reopens where its setup left off. */}
      <ComputerBuyFlow
        open={buying() || !!settingUp()}
        computerId={settingUp()}
        resumeStep={resumeAt()}
        onClose={() => {
          setBuying(false);
          setSettingUp(undefined);
          setResumeAt(undefined);
        }}
      />
      <Show when={byId(signingIn())?.harnessId}>
        {(harnessId) => (
          <ClaudeSignInDialog
            harnessId={harnessId()}
            entry="computer_row"
            onClose={() => setSigningIn(undefined)}
          />
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
            onRelease={(typedName) =>
              fireAndForget(releaseNow(computer, typedName), 'macro-computers')
            }
          />
        )}
      </Show>
    </Show>
  );
}
