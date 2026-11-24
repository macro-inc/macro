import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { t } from '@app/lib/i18n';
import type { ComputerSize, SizeOffer } from '@service-auth/computers';
import { For, Show } from 'solid-js';
import { ChoiceRow } from '../../primitives';
import { formatQuote, offerSpecs, sizeLabel } from '../core/computer-display';

/**
 * One choice per size; sold-out sizes show disabled with Sold out. Sizes no
 * host can run are not offered, so the list can be empty.
 */
export function ComputerSizePicker(props: {
  offers: readonly SizeOffer[];
  selected: ComputerSize | undefined;
  onSelect: (size: ComputerSize) => void;
}) {
  return (
    <fieldset class="flex min-w-0 flex-col gap-2">
      <legend class="sr-only">{t('computers.sizeLegend')}</legend>
      <For
        each={props.offers}
        fallback={
          <p class="text-sm text-ink-muted">{t('computers.noSizes')}</p>
        }
      >
        {(offer) => (
          <ChoiceRow
            name="macro-computer-size"
            value={offer.size}
            checked={props.selected === offer.size}
            title={sizeLabel(offer.size)}
            description={offerSpecs(offer)}
            disabled={offer.soldOut}
            onChange={() => props.onSelect(offer.size)}
            aside={
              <Show
                when={offer.soldOut}
                fallback={
                  <span class="whitespace-nowrap text-sm font-medium tabular-nums text-ink">
                    {offer.quote.amount === 0
                      ? t('computers.included')
                      : formatQuote(offer.quote)}
                  </span>
                }
              >
                <span class="whitespace-nowrap text-xs font-medium text-ink-muted">
                  Sold out
                </span>
              </Show>
            }
          />
        )}
      </For>
    </fieldset>
  );
}

/** The three sizes on sale, as shimmering cards while the real ones load. */
export function ComputerSizeSkeleton() {
  return (
    <ListSkeleton.Root
      label={t('computers.loadingSizes')}
      class="flex min-w-0 flex-col gap-2"
    >
      <For each={[0, 1, 2]}>
        {() => (
          <div class="flex items-start gap-3 rounded-lg border border-edge-muted p-3">
            <ListSkeleton.Bar class="mt-0.5 size-4 shrink-0" />
            <div class="flex min-w-0 flex-1 flex-col gap-2 py-0.5">
              <ListSkeleton.Bar class="h-3 w-20" />
              <ListSkeleton.Bar class="h-2.5 w-40 max-w-full" />
            </div>
            <ListSkeleton.Bar class="h-3 w-16 self-center" />
          </div>
        )}
      </For>
    </ListSkeleton.Root>
  );
}
