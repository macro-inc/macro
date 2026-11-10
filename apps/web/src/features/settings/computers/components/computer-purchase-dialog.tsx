import { t } from '@app/lib/i18n';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import type { ComputerSize, SizeOffer } from '@service-auth/computers';
import { ActionDialogShell, Button, Dialog, Input } from '@ui';
import { createSignal, createUniqueId, Show } from 'solid-js';
import { PriceBreakdown } from '../../components/price-breakdown';
import { formatQuote, offerSpecs, sizeLabel } from '../core/computer-display';
import { ComputerSizePicker } from './computer-size-picker';

/**
 * Picks a size and name, and shows the exact price, before a computer is
 * added to the subscription.
 */
export function ComputerPurchaseDialog(props: {
  offers: readonly SizeOffer[];
  /** Prefilled, editable: "Maya's Agent Box". */
  defaultName: string;
  pending: boolean;
  /** The size a Notify me request is in flight for. */
  notifyPending?: ComputerSize;
  error?: string;
  onClose: () => void;
  onNotify: (size: ComputerSize) => void;
  onConfirm: (offer: SizeOffer, name: string | undefined) => void;
}) {
  const nameId = createUniqueId();
  const [name, setName] = createSignal(props.defaultName);
  const [size, setSize] = createSignal(
    props.offers.find((offer) => !offer.soldOut)?.size
  );
  const offer = () =>
    props.offers.find((item) => item.size === size() && !item.soldOut);

  const buyLabel = () => {
    const chosen = offer();
    if (!chosen) return t('computers.buy');
    if (chosen.quote.amount === 0) return t('settingsBilling.buyIncluded');
    return t('settingsBilling.buyPriced', { price: formatQuote(chosen.quote) });
  };

  const confirm = () => {
    const chosen = offer();
    if (props.pending || !chosen) return;
    const trimmed = name().trim();
    props.onConfirm(chosen, trimmed.length > 0 ? trimmed : undefined);
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && !props.pending && props.onClose()}
      position="center"
      visibleScrim
      class="w-[min(440px,calc(100vw-16px))]"
    >
      <ActionDialogShell class="h-auto">
        <ActionDialogShell.Body>
          <ActionDialogShell.Header>
            <ActionDialogShell.Title>
              {t('computers.sizeTitle')}
            </ActionDialogShell.Title>
            <ActionDialogShell.Description>
              {t('computers.description')}
            </ActionDialogShell.Description>
          </ActionDialogShell.Header>

          <ComputerSizePicker
            offers={props.offers}
            selected={size()}
            notifyPending={props.notifyPending}
            onSelect={setSize}
            onNotify={props.onNotify}
          />

          <div class="flex flex-col gap-2">
            <label for={nameId} class="text-sm leading-5 text-ink-muted">
              {t('computers.name')}
            </label>
            <Input
              id={nameId}
              type="text"
              value={name()}
              maxLength={64}
              disabled={props.pending}
              onInput={(event) => setName(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') confirm();
              }}
            />
          </div>

          <Show when={offer()}>
            {(chosen) => (
              <PriceBreakdown
                currency={chosen().quote.currency}
                interval={chosen().quote.interval}
                total={chosen().quote.amount}
                included={chosen().quote.amount === 0}
                items={[
                  {
                    name: t('settingsBilling.sizedComputer', {
                      size: sizeLabel(chosen().size),
                    }),
                    description: offerSpecs(chosen()),
                    amount: chosen().quote.amount,
                    included: chosen().quote.amount === 0,
                  },
                ]}
              />
            )}
          </Show>

          <Show when={props.error}>
            {(error) => (
              <p role="alert" class="text-sm text-failure">
                {error()}
              </p>
            )}
          </Show>
        </ActionDialogShell.Body>

        <ActionDialogShell.Footer>
          <Button
            type="button"
            variant="ghost"
            disabled={props.pending}
            onClick={props.onClose}
          >
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={props.pending || !offer()}
            onClick={confirm}
          >
            <Show when={props.pending} fallback={buyLabel()}>
              <SpinnerIcon class="size-4 animate-spin" />
              <span class="sr-only">{t('computers.buying')}</span>
            </Show>
          </Button>
        </ActionDialogShell.Footer>
      </ActionDialogShell>
    </Dialog>
  );
}
