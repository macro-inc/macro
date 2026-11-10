import { t } from '@app/lib/i18n';
import { useComputerOffersQuery } from '@queries/computers/computers';
import { useIsTeamAdmin } from '@queries/team/teams';
import { createSignal, Show } from 'solid-js';
import { formatQuote } from '../core/computer-display';
import { useTeamComputers } from '../primitives/team-computers';
import { ComputerBuyFlow } from './computer-buy-flow';
import { cheapestOffer, GetComputerRow } from './MacroComputers';

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
    const offer = offers.isSuccess ? cheapestOffer(offers.data) : undefined;
    if (!offer) return undefined;
    const price =
      offer.quote.amount === 0
        ? t('computers.included')
        : t('computers.fromPrice', { price: formatQuote(offer.quote) });
    return `${price} · ${t('computers.readyInMinutes')}`;
  };
  return { canBuy, fromLine, hasComputers: () => computers().length > 0 };
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
