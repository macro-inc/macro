import {
  formatPlanPrice,
  type PaidPlanTier,
  PLAN_BY_TIER,
} from '@app/features/paywall/plans';
import type { BillingInterval } from '@service-auth/generated/schemas/billingInterval';
import { ActionDialogShell, Button, Dialog, RadioGroup } from '@ui';
import { createSignal, For, Show } from 'solid-js';

/**
 * Compact billing-cycle step shown before hosted checkout for plans sold both
 * annually and monthly (Business and Max). Renders as a centered dialog on
 * desktop and a bottom drawer on mobile through `Dialog`.
 */
export function BillingCycleDialog(props: {
  plan: PaidPlanTier | null;
  perSeat?: boolean;
  pending?: boolean;
  monthlyPriceCents?: number;
  annualPricePerMonthCents?: number;
  onClose: () => void;
  onConfirm: (plan: PaidPlanTier, interval: BillingInterval) => void;
}) {
  return (
    <Dialog
      open={props.plan !== null}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      position="center"
      class="w-110 max-w-full"
    >
      <Show when={props.plan} keyed>
        {(plan) => (
          <BillingCycleDialogBody
            plan={plan}
            perSeat={props.perSeat}
            pending={props.pending}
            monthlyPriceCents={props.monthlyPriceCents}
            annualPricePerMonthCents={props.annualPricePerMonthCents}
            onClose={props.onClose}
            onConfirm={props.onConfirm}
          />
        )}
      </Show>
    </Dialog>
  );
}

function BillingCycleDialogBody(props: {
  plan: PaidPlanTier;
  perSeat?: boolean;
  pending?: boolean;
  monthlyPriceCents?: number;
  annualPricePerMonthCents?: number;
  onClose: () => void;
  onConfirm: (plan: PaidPlanTier, interval: BillingInterval) => void;
}) {
  const [interval, setInterval] = createSignal<BillingInterval>('year');

  const planInfo = () => PLAN_BY_TIER[props.plan];
  const monthlyCents = () => props.monthlyPriceCents ?? planInfo().price * 100;
  const annualPerMonthCents = () =>
    props.annualPricePerMonthCents ??
    (planInfo().annualPrice ?? planInfo().price) * 100;
  const annualSavingsCents = () =>
    Math.max(0, (monthlyCents() - annualPerMonthCents()) * 12);
  const unit = () => (props.perSeat ? 'seat / month' : 'month');

  const options = () => {
    const annual = annualPerMonthCents();
    const monthly = monthlyCents();
    const savings = annualSavingsCents();
    return [
      {
        value: 'year' as const,
        label: 'Billed annually',
        price: `${formatPlanPrice(annual) ?? '—'} / ${unit()}`,
        detail: `${formatPlanPrice(annual * 12) ?? '—'} per ${props.perSeat ? 'seat / year' : 'year'}`,
        badge:
          savings > 0 ? `Save ${formatPlanPrice(savings) ?? ''}/yr` : undefined,
      },
      {
        value: 'month' as const,
        label: 'Billed monthly',
        price: `${formatPlanPrice(monthly) ?? '—'} / ${unit()}`,
        detail: 'Pay month to month',
        badge: undefined,
      },
    ];
  };

  return (
    <ActionDialogShell>
      <ActionDialogShell.Body>
        <ActionDialogShell.Header>
          <ActionDialogShell.Title>
            Choose billing cycle for {planInfo().name}
          </ActionDialogShell.Title>
          <ActionDialogShell.Description>
            Select annual or monthly billing before continuing to checkout.
          </ActionDialogShell.Description>
        </ActionDialogShell.Header>

        <RadioGroup
          variant="cards"
          aria-label="Billing cycle"
          value={interval()}
          onChange={(value) => {
            if (value === 'year' || value === 'month') {
              setInterval(value);
            }
          }}
        >
          <For each={options()}>
            {(option) => (
              <RadioGroup.Item
                value={option.value}
                class="w-full justify-between px-4 py-3"
              >
                <div class="flex items-start gap-3">
                  <RadioGroup.ItemControl class="mt-0.5" />
                  <div class="flex flex-col gap-0.5">
                    <div class="flex items-center gap-2">
                      <RadioGroup.ItemLabel class="text-sm font-medium text-ink">
                        {option.label}
                      </RadioGroup.ItemLabel>
                      <Show when={option.badge}>
                        {(badge) => (
                          <span class="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent">
                            {badge()}
                          </span>
                        )}
                      </Show>
                    </div>
                    <RadioGroup.ItemDescription class="text-xs text-ink-extra-muted">
                      {option.detail}
                    </RadioGroup.ItemDescription>
                  </div>
                </div>
                <span class="shrink-0 text-sm font-medium tabular-nums text-ink">
                  {option.price}
                </span>
              </RadioGroup.Item>
            )}
          </For>
        </RadioGroup>
      </ActionDialogShell.Body>
      <ActionDialogShell.Footer>
        <Button
          size="sm"
          variant="ghost"
          disabled={props.pending}
          onClick={props.onClose}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={props.pending}
          onClick={() => props.onConfirm(props.plan, interval())}
        >
          Continue to checkout
        </Button>
      </ActionDialogShell.Footer>
    </ActionDialogShell>
  );
}
