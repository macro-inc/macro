import { t } from '@app/lib/i18n';
import HardDrivesIcon from '@icon/system/regular/hard-drives.svg';
import PlusIcon from '@icon/system/regular/plus.svg';
import { useComputerOffersQuery } from '@queries/computers/computers';
import { useIsTeamAdmin } from '@queries/team/teams';
import { Button } from '@ui';
import { createEffect, createSignal, type JSX, Show } from 'solid-js';
import { SettingsSelect } from '../../components/settings-select';
import { WhereItRunsOption } from '../../components/where-it-runs-option';
import { useTeamComputers } from '../primitives/team-computers';
import { ComputerBuyFlow } from './computer-buy-flow';
import {
  fromPriceText,
  GetComputerRow,
  offersBlockedByTrial,
} from './MacroComputers';

/**
 * Whether the viewer can buy the team a computer from Settings → Agents, and
 * the line that sells it: "From $20/month · ready in minutes", priced from
 * the cheapest size on sale.
 */
export function useComputerOffer() {
  const isAdmin = useIsTeamAdmin();
  const { canPurchase, computers } = useTeamComputers();
  const canBuy = () => canPurchase() && isAdmin();
  const offers = useComputerOffersQuery(canBuy);
  const fromLine = () => {
    const price = fromPriceText(
      offers.isSuccess ? offers.data : undefined,
      'leading'
    );
    return price && `${price} · ${t('computers.readyInMinutes')}`;
  };
  return {
    // A trialing team can't buy; Settings → Machines says why.
    canBuy: () => canBuy() && !offersBlockedByTrial(offers),
    fromLine,
    hasComputers: () => computers().length > 0,
  };
}

/**
 * The Agents list's one quiet row for a team with no computer yet. It goes
 * away once the team has one.
 */
export function RunOnComputerRow() {
  const offer = useComputerOffer();
  const [buying, setBuying] = createSignal(false);
  return (
    <>
      <Show when={offer.canBuy() && !offer.hasComputers() && offer.fromLine()}>
        {(line) => (
          <GetComputerRow
            title={t('computers.runAgentsTitle')}
            description={line()}
            onGet={() => setBuying(true)}
            class="gap-4 px-6 py-4 touch:px-4"
          />
        )}
      </Show>
      <ComputerBuyFlow open={buying()} onClose={() => setBuying(false)} />
    </>
  );
}

/**
 * The agent editor's Where it runs option for the team's Macro computers: a
 * computer picker and the model, or with none yet, New Macro computer. Buying
 * from here selects the new computer once its runtime registers.
 */
export function ComputerWhereItRuns(props: {
  computers: { id: string; name: string }[];
  harnessId: string;
  checked: boolean;
  busy: boolean;
  modelPicker: JSX.Element;
  onSelect: (harnessId: string) => void;
}) {
  const offer = useComputerOffer();
  const [buying, setBuying] = createSignal(false);
  const [bought, setBought] = createSignal<string>();
  createEffect(() => {
    const harnessId = bought();
    if (harnessId && props.computers.some((item) => item.id === harnessId)) {
      props.onSelect(harnessId);
      setBought(undefined);
    }
  });
  const buyButton = (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      class="text-ink"
      disabled={props.busy}
      onClick={() => setBuying(true)}
    >
      {t('computers.getComputerAction')}
    </Button>
  );
  return (
    <>
      <Show
        when={props.computers.length > 0}
        fallback={
          <Show when={offer.canBuy()}>
            <WhereItRunsOption
              value="new-computer"
              title={t('computers.newComputer')}
              description={offer.fromLine() ?? t('computers.onComputerHint')}
              icon={<HardDrivesIcon />}
              checked={false}
              disabled
              action={buyButton}
              onSelect={() => setBuying(true)}
            />
          </Show>
        }
      >
        <WhereItRunsOption
          value="computer"
          title={t('computers.onComputer')}
          description={t('computers.onComputerHint')}
          icon={<HardDrivesIcon />}
          checked={props.checked}
          onSelect={() => {
            const first = props.computers[0];
            if (first) props.onSelect(first.id);
          }}
        >
          <div class="grid grid-cols-1 gap-3 @min-[440px]:grid-cols-[repeat(2,minmax(0,280px))]">
            <div class="flex min-w-0 flex-col gap-1.5">
              <span class="text-xs font-medium text-ink-muted">
                {t('computers.computerKind')}
              </span>
              <SettingsSelect
                label={t('computers.computerKind')}
                options={props.computers}
                value={props.harnessId}
                onChange={props.onSelect}
              />
            </div>
            {props.modelPicker}
          </div>
          <Show when={offer.canBuy()}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              class="mt-2 -ml-2"
              disabled={props.busy}
              onClick={() => setBuying(true)}
            >
              <PlusIcon class="size-3 touch:size-6 shrink-0 pointer-events-none" />
              {[t('computers.newComputer'), offer.fromLine()]
                .filter(Boolean)
                .join(' · ')}
            </Button>
          </Show>
        </WhereItRunsOption>
      </Show>
      <ComputerBuyFlow
        open={buying()}
        onClose={() => setBuying(false)}
        onFinished={(computer) => setBought(computer.harnessId ?? undefined)}
      />
    </>
  );
}
