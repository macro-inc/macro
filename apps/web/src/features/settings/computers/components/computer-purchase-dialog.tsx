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
  const renewal = () =>
    match(props.offer.quote.interval)
      .with('month', () => 'each month')
      .with('year', () => 'each year')
      .exhaustive((unknown) => `each ${unknown}`);

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
              Buy a {sizeLabel(props.offer.size)} Macro computer?
            </ActionDialogShell.Title>
            <ActionDialogShell.Description as="div" class="space-y-2">
              <p>{offerSpecs(props.offer)}.</p>
              <p>
                <span class="font-medium text-ink">{price()}</span>, added to
                your team's subscription today. You're charged a prorated amount
                now for the rest of this billing period, then {price()}{' '}
                {renewal()} with your subscription.
              </p>
            </ActionDialogShell.Description>
          </ActionDialogShell.Header>

          <div class="flex flex-col gap-2">
            <label for={nameId} class="text-sm leading-5 text-ink-muted">
              Name (optional)
            </label>
            <Input
              id={nameId}
              type="text"
              value={name()}
              maxLength={64}
              placeholder="Build machine"
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
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={props.pending}
            onClick={confirm}
          >
            <Show when={props.pending} fallback={`Buy for ${price()}`}>
              <SpinnerIcon class="size-4 animate-spin" />
              <span class="sr-only">Buying</span>
            </Show>
          </Button>
        </ActionDialogShell.Footer>
      </ActionDialogShell>
    </Dialog>
  );
}
