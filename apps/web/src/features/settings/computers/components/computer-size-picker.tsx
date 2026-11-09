import { t } from '@app/lib/i18n';
import type { ComputerSize, SizeOffer } from '@service-auth/computers';
import { Button } from '@ui';
import { For, Show } from 'solid-js';
import { ChoiceRow } from '../../primitives';
import { formatQuote, offerSpecs, sizeLabel } from '../core/computer-display';

/** One choice per size; sold-out sizes can't be picked but offer Notify me. */
export function ComputerSizePicker(props: {
  offers: readonly SizeOffer[];
  selected: ComputerSize | undefined;
  /** The size a Notify me request is in flight for. */
  notifyPending?: ComputerSize;
  onSelect: (size: ComputerSize) => void;
  onNotify: (size: ComputerSize) => void;
}) {
  return (
    <fieldset class="flex min-w-0 flex-col gap-2">
      <legend class="sr-only">Computer size</legend>
      <For each={props.offers}>
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
                <span class="flex flex-col items-end gap-1">
                  <span class="text-xs font-medium text-ink-muted">
                    Sold out
                  </span>
                  <Show
                    when={!offer.notifyRequested}
                    fallback={
                      <span class="text-xs text-ink-extra-muted">
                        We'll let you know
                      </span>
                    }
                  >
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={props.notifyPending === offer.size}
                      onClick={() => props.onNotify(offer.size)}
                    >
                      Notify me
                    </Button>
                  </Show>
                </span>
              </Show>
            }
          />
        )}
      </For>
    </fieldset>
  );
}
