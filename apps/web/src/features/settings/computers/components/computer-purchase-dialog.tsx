import { t } from '@app/lib/i18n';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import type { SizeOffer } from '@service-auth/computers';
import { ActionDialogShell, Button, Dialog, Input } from '@ui';
import { createSignal, createUniqueId, Show } from 'solid-js';
import { match } from 'ts-pattern';
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
  const billingDescription = () =>
    match(props.offer.quote.interval)
      .with('month', () => t('computers.purchaseMonthly', { price: price() }))
      .with('year', () => t('computers.purchaseYearly', { price: price() }))
      .exhaustive((interval) =>
        t('computers.purchaseInterval', {
          price: price(),
          interval: String(interval),
        })
      );

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
      <ActionDialogShell>
        <ActionDialogShell.Body>
          <ActionDialogShell.Header>
            <ActionDialogShell.Title>
              {t('computers.purchaseTitle', {
                size: sizeLabel(props.offer.size),
              })}
            </ActionDialogShell.Title>
            <ActionDialogShell.Description as="div" class="space-y-2">
              <p>{offerSpecs(props.offer)}.</p>
              <p>{billingDescription()}</p>
            </ActionDialogShell.Description>
          </ActionDialogShell.Header>

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
              fallback={t('computers.buyFor', { price: price() })}
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
