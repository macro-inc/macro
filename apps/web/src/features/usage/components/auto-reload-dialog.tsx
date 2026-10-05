import XIcon from '@phosphor/x.svg';
import { Button, Dialog, InputGroup, Surface, TextField } from '@ui';
import { Show } from 'solid-js';

export function AutoReloadDialog(props: {
  enabled: boolean;
  minimum: string;
  target: string;
  maximum: string;
  onMinimum: (value: string) => void;
  onTarget: (value: string) => void;
  onMaximum: (value: string) => void;
  onClose: () => void;
  onRestoreFocus?: () => void;
  onSave: () => void;
  onTurnOff: () => void;
  onPaymentMethods: () => void;
  canManagePaymentMethods: boolean;
  pending: boolean;
  paymentMethodsPending: boolean;
  disabled: boolean;
  invalid: boolean;
  notice?: string;
  error?: string;
}) {
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
      class="w-160"
    >
      <Surface depth={2} class="relative rounded-xl">
        <div class="flex max-h-[85dvh] flex-col gap-6 overflow-y-auto p-6">
          <Dialog.Title class="pr-8 text-xl font-semibold text-ink">
            Auto-Reload
          </Dialog.Title>
          <Dialog.Description class="sr-only">
            Set balance thresholds and a monthly spending limit for automatic
            credit purchases.
          </Dialog.Description>
          <TextField value={props.minimum} onChange={props.onMinimum}>
            <TextField.Label>Minimum balance</TextField.Label>
            <TextField.Description>
              Automatically purchase credits when my balance drops below this
              amount.
            </TextField.Description>
            <InputGroup size="xl">
              <TextField.Input
                as={InputGroup.Input}
                inputMode="decimal"
                class="text-sm"
              />
              <InputGroup.Addon aria-hidden="true">$</InputGroup.Addon>
            </InputGroup>
          </TextField>
          <TextField value={props.target} onChange={props.onTarget}>
            <TextField.Label>Target balance</TextField.Label>
            <TextField.Description>
              Bring my balance back to this amount if I hit my minimum.
            </TextField.Description>
            <InputGroup size="xl">
              <TextField.Input
                as={InputGroup.Input}
                inputMode="decimal"
                class="text-sm"
              />
              <InputGroup.Addon aria-hidden="true">$</InputGroup.Addon>
            </InputGroup>
          </TextField>
          <TextField value={props.maximum} onChange={props.onMaximum}>
            <TextField.Label>Maximum monthly spend (optional)</TextField.Label>
            <TextField.Description>
              Limit the total amount of credits purchased through auto-reload
              each month. Leave blank for no limit.
            </TextField.Description>
            <InputGroup size="xl">
              <TextField.Input
                as={InputGroup.Input}
                inputMode="decimal"
                class="text-sm"
                placeholder="No limit."
              />
              <InputGroup.Addon aria-hidden="true">$</InputGroup.Addon>
            </InputGroup>
          </TextField>
          <div class="flex flex-col gap-2">
            <h3 class="text-sm font-medium text-ink">Payment method</h3>
            <p class="text-xs text-ink-muted">
              Choose or add a payment method in your billing portal.
            </p>
            <Button
              class="self-start"
              variant="outline"
              depth={3}
              size="sm"
              disabled={
                !props.canManagePaymentMethods || props.paymentMethodsPending
              }
              onClick={props.onPaymentMethods}
            >
              {props.paymentMethodsPending
                ? 'Opening billing portal…'
                : 'Manage payment methods'}
            </Button>
          </div>
          <div class="rounded-xl border border-edge-muted p-4">
            <h3 class="text-sm font-semibold text-ink">
              Your card will be automatically charged
            </h3>
            <p class="mt-2 text-sm text-ink-muted">
              Enabling auto-reload will charge your card every time you drop
              below your minimum balance. You can disable it in settings at any
              time.
            </p>
          </div>
          <Show when={props.notice}>
            <p class="text-xs text-ink-muted" role="status">
              {props.notice}
            </p>
          </Show>
          <Show when={props.error}>
            <p class="text-sm text-failure" role="alert">
              {props.error}
            </p>
          </Show>
          <div class="flex justify-end gap-2">
            <Show
              when={props.enabled}
              fallback={
                <Button variant="ghost" depth={3} onClick={props.onClose}>
                  Cancel
                </Button>
              }
            >
              <Button
                variant="ghost"
                depth={3}
                disabled={props.disabled || props.pending}
                onClick={props.onTurnOff}
              >
                Turn off
              </Button>
            </Show>
            <Button
              variant="accent"
              depth={3}
              disabled={props.disabled || props.pending || props.invalid}
              onClick={props.onSave}
            >
              {props.pending
                ? 'Saving…'
                : props.enabled
                  ? 'Save'
                  : 'Turn on auto-reload'}
            </Button>
          </div>
        </div>
        <Button
          class="absolute right-4 top-4"
          size="icon-sm"
          variant="ghost"
          depth={3}
          label="Close Auto-Reload"
          onClick={props.onClose}
        >
          <XIcon class="size-4" />
        </Button>
      </Surface>
    </Dialog>
  );
}
