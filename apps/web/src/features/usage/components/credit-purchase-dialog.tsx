import XIcon from '@phosphor/x.svg';
import { Button, Dialog, InputGroup, Surface } from '@ui';
import { createUniqueId, For, Show } from 'solid-js';
import { formatCreditBalance } from '../core/usage';

export function CreditPurchaseDialog(props: {
  selection: number | 'other';
  customAmount: string;
  amountCents: number | undefined;
  onSelect: (amount: number | 'other') => void;
  onCustomAmount: (amount: string) => void;
  onClose: () => void;
  onRestoreFocus?: () => void;
  onCheckout: () => void;
  onViewPlans?: () => void;
  pending: boolean;
  disabled: boolean;
  notice?: string;
  error?: string;
}) {
  const name = createUniqueId();
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      onCloseAutoFocus={
        props.onRestoreFocus
          ? (event) => {
              event.preventDefault();
              props.onRestoreFocus?.();
            }
          : undefined
      }
      position="center"
      class="w-180"
    >
      <Surface depth={2} class="relative rounded-xl">
        <div class="flex max-h-[85dvh] flex-col gap-5 overflow-y-auto p-6">
          <header class="pr-8">
            <Dialog.Title class="text-xl font-semibold text-ink">
              Need more usage?
            </Dialog.Title>
            <Dialog.Description class="mt-1 text-sm text-ink-muted">
              Choose an amount to start. You can always buy more later.
            </Dialog.Description>
          </header>
          <fieldset class="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <legend class="sr-only">Credit amount</legend>
            <For each={[2_500, 5_000, 10_000, 'other'] as const}>
              {(amount) => (
                <label class="relative flex min-h-22 items-start rounded-xl border border-edge-muted p-4 has-checked:border-accent has-checked:ring-1 has-checked:ring-accent focus-within:ring-2 focus-within:ring-accent">
                  <input
                    class="sr-only"
                    type="radio"
                    name={name}
                    value={amount}
                    checked={props.selection === amount}
                    onChange={() => props.onSelect(amount)}
                  />
                  <span class="text-base font-semibold text-ink">
                    {amount === 'other' ? 'Other' : formatCreditBalance(amount)}
                  </span>
                </label>
              )}
            </For>
          </fieldset>
          <Show when={props.selection === 'other'}>
            <InputGroup size="xl">
              <InputGroup.Input
                aria-label="Custom credit amount in dollars"
                inputMode="decimal"
                class="text-sm"
                placeholder="Enter amount"
                value={props.customAmount}
                onInput={(event) =>
                  props.onCustomAmount(event.currentTarget.value)
                }
              />
              <InputGroup.Addon aria-hidden="true">$</InputGroup.Addon>
            </InputGroup>
          </Show>
          <div class="rounded-xl border border-edge-muted p-4 text-sm text-ink">
            <div class="flex justify-between gap-4">
              <span>Usage credits</span>
              <span>{formatCreditBalance(props.amountCents ?? 0)}</span>
            </div>
            <div class="mt-4 flex justify-between gap-4 border-t border-edge-muted pt-4">
              <span>Total</span>
              <span class="font-semibold">
                {formatCreditBalance(props.amountCents ?? 0)}
              </span>
            </div>
          </div>
          <p class="text-xs text-ink-muted">
            Choose or add your payment method and review your purchase in Stripe
            Checkout.
          </p>
          <Show when={props.notice}>
            <p class="text-sm text-ink-muted" role="status">
              {props.notice}
            </p>
          </Show>
          <Show when={props.error}>
            <p class="text-sm text-failure" role="alert">
              {props.error}
            </p>
          </Show>
          <div class="flex justify-end gap-2">
            <Button variant="ghost" depth={3} onClick={props.onClose}>
              Cancel
            </Button>
            <Show
              when={props.onViewPlans}
              fallback={
                <Button
                  variant="accent"
                  depth={3}
                  disabled={props.disabled || props.pending}
                  onClick={props.onCheckout}
                >
                  {props.pending ? 'Opening checkout…' : 'Continue to checkout'}
                </Button>
              }
            >
              {(viewPlans) => (
                <Button variant="accent" depth={3} onClick={viewPlans()}>
                  View plans
                </Button>
              )}
            </Show>
          </div>
        </div>
        <Button
          class="absolute right-4 top-4"
          size="icon-sm"
          variant="ghost"
          depth={3}
          label="Close credit purchase"
          onClick={props.onClose}
        >
          <XIcon class="size-4" />
        </Button>
      </Surface>
    </Dialog>
  );
}
