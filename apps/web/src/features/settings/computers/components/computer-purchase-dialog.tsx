import { t } from '@app/lib/i18n';
import SpinnerIcon from '@icon/system/regular/spinner.svg';
import type { SizeOffer } from '@service-auth/computers';
import { ActionDialogShell, Button, Input } from '@ui';
import {
  createSignal,
  createUniqueId,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import {
  formatQuote,
  type OffersFailure,
  sizeLabel,
} from '../core/computer-display';
import {
  ComputerSizePicker,
  ComputerSizeSkeleton,
} from './computer-size-picker';
import { FailureNotice } from './failure-notice';

/**
 * Why the sizes could not load, in place of the size cards. The remedy is in
 * the footer, so the alert carries only the message.
 */
function OffersFailureNotice(props: { failure: OffersFailure }) {
  return <FailureNotice>{props.failure.message}</FailureNotice>;
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
  /** The card was declined: Update card beside the notice, Try again on Buy. */
  declined?: boolean;
  /** No host has room for this size right now; it reads as sold out. */
  noRoomSize?: SizeOffer['size'];
  /** Under Buy: what happens after it. */
  headsUp: string;
  /** The size or name changed, so an earlier refusal no longer applies. */
  onEdit?: () => void;
  onClose: () => void;
  onRetry: () => void;
  onBilling: () => void;
  onConfirm: (offer: SizeOffer, name: string | undefined) => void;
}) {
  const nameId = createUniqueId();
  const [name, setNameValue] = createSignal(props.defaultName);
  const [chosenSize, setChosenSize] = createSignal<SizeOffer['size']>();
  const setName = (value: string) => {
    setNameValue(value);
    props.onEdit?.();
  };
  const setSize = (value: SizeOffer['size']) => {
    setChosenSize(value);
    props.onEdit?.();
  };
  const offers = () =>
    props.offers?.map((offer) =>
      offer.size === props.noRoomSize ? { ...offer, soldOut: true } : offer
    );
  const onSale = (size: SizeOffer['size'] | undefined) =>
    offers()?.find((item) => item.size === size && !item.soldOut);
  // Until a size on sale is picked, the first on sale; the sizes may arrive
  // after the step opened, and the picked one may run out of room.
  const offer = () =>
    onSale(chosenSize()) ?? offers()?.find((item) => !item.soldOut);
  const size = () => offer()?.size;
  // Sizes no host can run are left out, so the list can be empty: then there
  // is nothing to name, price or buy.
  const noSizes = () => props.offers?.length === 0;

  const buyLabel = () => {
    const chosen = offer();
    if (!chosen) return t('computers.buy');
    if (chosen.quote.amount === 0) return t('settingsBilling.buyIncluded');
    const price = formatQuote(chosen.quote);
    if (props.declined) return t('computers.tryAgainPriced', { price });
    return t('settingsBilling.buyPriced', { price });
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
          <Match when={noSizes()}>
            <div
              role="status"
              class="flex flex-col gap-1 rounded-lg border border-edge-muted p-4"
            >
              <p class="text-sm text-ink">{t('computers.noSizes')}</p>
              <p class="text-sm text-ink-muted text-pretty">
                {t('computers.noSizesReason')}
              </p>
            </div>
          </Match>
          <Match when={offers()}>
            {(available) => (
              <>
                <ComputerSizePicker
                  offers={available()}
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

                <Switch>
                  <Match when={props.declined}>
                    <FailureNotice
                      actions={
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={props.onBilling}
                        >
                          {t('computers.updateCard')}
                        </Button>
                      }
                    >
                      {t('computers.declined')}
                    </FailureNotice>
                  </Match>
                  <Match when={props.noRoomSize}>
                    {(full) => (
                      <FailureNotice>
                        {t('computers.noRoom', { size: sizeLabel(full()) })}
                      </FailureNotice>
                    )}
                  </Match>
                  <Match when={props.error}>
                    {(error) => (
                      <p role="alert" class="text-sm text-failure">
                        {error()}
                      </p>
                    )}
                  </Match>
                </Switch>
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
          {props.failure || noSizes() ? t('common.close') : t('common.cancel')}
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
                {t('computers.gettingIt')}
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
          <Match when={noSizes()}>{null}</Match>
        </Switch>
        <Show when={!props.failure && !noSizes()}>
          <p
            role={props.pending ? 'status' : undefined}
            class="basis-full text-right text-xs text-ink-muted text-pretty"
          >
            <Switch fallback={props.headsUp}>
              <Match when={!props.offers}>
                {t('computers.buyAfterSizesLoad')}
              </Match>
              {/* The button says it is getting the computer. */}
              <Match when={props.pending}>{null}</Match>
              <Match when={props.declined}>
                {t('computers.declinedCaption')}
              </Match>
            </Switch>
          </p>
        </Show>
      </ActionDialogShell.Footer>
    </>
  );
}
