import { t } from '@app/lib/i18n';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import WarningCircleIcon from '@icon/system/regular/warning-circle.svg';
import type { SizeOffer } from '@service-auth/computers';
import { ActionDialogShell, Button, Input } from '@ui';
import {
  createEffect,
  createSignal,
  createUniqueId,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { formatQuote, type OffersFailure } from '../core/computer-display';
import {
  ComputerSizePicker,
  ComputerSizeSkeleton,
} from './computer-size-picker';

/**
 * Why the sizes could not load, in place of the size cards. The remedy is in
 * the footer, so the alert carries only the message.
 */
function OffersFailureNotice(props: { failure: OffersFailure }) {
  return (
    <div class="flex items-start gap-3 rounded-lg border border-edge-muted p-4">
      <WarningCircleIcon
        aria-hidden="true"
        class="mt-0.5 size-4 shrink-0 text-failure"
      />
      <p role="alert" class="min-w-0 text-sm text-ink text-pretty">
        {props.failure.message}
      </p>
    </div>
  );
}

/**
 * Guided setup's first step: pick a size and name, and see the exact price,
 * before a computer is added to the subscription. Without `offers` it shows
 * the sizes loading, or `failure` and its remedy.
 */
export function ComputerPurchaseStep(props: {
  /** Guided setup's step header, above the title. */
  header?: JSX.Element;
  /** Unset while the sizes load or could not load. */
  offers: readonly SizeOffer[] | undefined;
  failure?: OffersFailure;
  /** A retry of the sizes is in flight. */
  retrying: boolean;
  /** Prefilled, editable: "Maya's Agent Box". */
  defaultName: string;
  pending: boolean;
  error?: string;
  onClose: () => void;
  onRetry: () => void;
  onBilling: () => void;
  onConfirm: (offer: SizeOffer, name: string | undefined) => void;
}) {
  const nameId = createUniqueId();
  const [name, setName] = createSignal(props.defaultName);
  const [size, setSize] = createSignal<SizeOffer['size']>();
  // The sizes may arrive after the step opened: pick the first on sale once.
  createEffect(() => {
    const first = props.offers?.find((offer) => !offer.soldOut);
    if (first && !size()) setSize(first.size);
  });
  const offer = () =>
    props.offers?.find((item) => item.size === size() && !item.soldOut);

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
    <>
      <ActionDialogShell.Body>
        {props.header}
        <ActionDialogShell.Header>
          <ActionDialogShell.Title>
            {t('computers.sizeTitle')}
          </ActionDialogShell.Title>
          <ActionDialogShell.Description>
            {t('computers.getComputerLine')}
          </ActionDialogShell.Description>
        </ActionDialogShell.Header>

        <Switch fallback={<ComputerSizeSkeleton />}>
          <Match when={props.failure}>
            {(failure) => <OffersFailureNotice failure={failure()} />}
          </Match>
          <Match when={props.offers}>
            {(offers) => (
              <>
                <ComputerSizePicker
                  offers={offers()}
                  selected={size()}
                  onSelect={setSize}
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

                {/* The price is on each size and on Buy; one line says how it bills. */}
                <p class="text-xs text-ink-muted">
                  {t('settingsBilling.proration')}
                </p>

                <Show when={props.error}>
                  {(error) => (
                    <p role="alert" class="text-sm text-failure">
                      {error()}
                    </p>
                  )}
                </Show>
              </>
            )}
          </Match>
        </Switch>
      </ActionDialogShell.Body>

      <ActionDialogShell.Footer>
        <Button
          type="button"
          variant="ghost"
          disabled={props.pending}
          onClick={props.onClose}
        >
          {props.failure ? t('common.close') : t('common.cancel')}
        </Button>
        <Switch
          fallback={
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
          }
        >
          <Match when={props.failure?.remedy === 'billing'}>
            <Button type="button" variant="primary" onClick={props.onBilling}>
              {t('computers.trialBillingAction')}
            </Button>
          </Match>
          <Match when={props.failure?.remedy === 'retry'}>
            <Button
              type="button"
              variant="primary"
              disabled={props.retrying}
              onClick={props.onRetry}
            >
              {t('computers.retry')}
            </Button>
          </Match>
          <Match when={props.failure?.remedy === 'none'}>{null}</Match>
        </Switch>
        <Show when={!props.failure}>
          <p class="basis-full text-right text-xs text-ink-muted text-pretty">
            {props.offers
              ? t('computers.buyHeadsUp')
              : t('computers.buyAfterSizesLoad')}
          </p>
        </Show>
      </ActionDialogShell.Footer>
    </>
  );
}
