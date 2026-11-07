import { t } from '@app/lib/i18n';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import type { SizeOffer } from '@service-auth/computers';
import { ActionDialogShell, Button, Dialog, Input } from '@ui';
import { createSignal, createUniqueId, Show } from 'solid-js';
import { PriceBreakdown } from '../../components/price-breakdown';
import { formatQuote, offerSpecs, sizeLabel } from '../core/computer-display';

/** Confirms the exact price before a computer is added to the subscription. */
export function ComputerPurchaseDialog(props: {
  offer: SizeOffer;
  pending: boolean;
  error?: string;
  onClose: () => void;
  onConfirm: (name: string | undefined) => void;
}) {
  const nameId = createUniqueId();
  const [name, setName] = createSignal('');
  const price = () => formatQuote(props.offer.quote);
  const included = () => props.offer.quote.amount === 0;

  const confirm = () => {
    if (props.pending) return;
    const trimmed = name().trim();
    props.onConfirm(trimmed.length > 0 ? trimmed : undefined);
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
              {t('computers.purchaseTitle', {
                size: sizeLabel(props.offer.size),
              })}
            </ActionDialogShell.Title>
            <ActionDialogShell.Description>
              {t('settingsBilling.purchaseDescription')}
            </ActionDialogShell.Description>
          </ActionDialogShell.Header>

          <PriceBreakdown
            currency={props.offer.quote.currency}
            interval={props.offer.quote.interval}
            total={props.offer.quote.amount}
            included={included()}
            items={[
              {
                name: t('settingsBilling.sizedComputer', {
                  size: sizeLabel(props.offer.size),
                }),
                description: offerSpecs(props.offer),
                amount: props.offer.quote.amount,
                included: included(),
              },
            ]}
          />

          <div class="flex flex-col gap-2">
            <label for={nameId} class="text-sm leading-5 text-ink-muted">
              {t('computers.nameOptional')}
            </label>
            <Input
              id={nameId}
              type="text"
              value={name()}
              maxLength={64}
              placeholder={t('computers.namePlaceholder')}
              disabled={props.pending}
              onInput={(event) => setName(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') confirm();
              }}
            />
          </div>

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
            disabled={props.pending}
            onClick={confirm}
          >
            <Show
              when={props.pending}
              fallback={
                included()
                  ? t('settingsBilling.buyIncluded')
                  : t('settingsBilling.buyPriced', { price: price() })
              }
            >
              <SpinnerIcon class="size-4 animate-spin" />
              <span class="sr-only">{t('computers.buying')}</span>
            </Show>
          </Button>
        </ActionDialogShell.Footer>
      </ActionDialogShell>
    </Dialog>
  );
}
