import {
  formatPlanPrice,
  type PaidPlanTier,
  PLAN_BY_TIER,
} from '@app/features/paywall/plans';
import type { BillingInterval } from '@service-auth/generated/schemas/billingInterval';
import { ActionDialogShell, Button, Dialog } from '@ui';
import { createEffect, createSignal, For, Show } from 'solid-js';

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
  const [interval, setInterval] = createSignal<BillingInterval>('year');

  createEffect(() => {
    if (props.plan) setInterval('year');
  });

  const planInfo = () => (props.plan ? PLAN_BY_TIER[props.plan] : undefined);
  const monthlyCents = () =>
    props.monthlyPriceCents ?? (planInfo()?.price ?? 0) * 100;
  const annualPerMonthCents = () =>
    props.annualPricePerMonthCents ??
    (planInfo()?.annualPrice ?? planInfo()?.price ?? 0) * 100;
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
    <Dialog
      open={props.plan !== null}
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
      position="center"
      class="w-110 max-w-full"
    >
      <Show when={props.plan}>
        {(plan) => (
          <ActionDialogShell>
            <ActionDialogShell.Body>
              <ActionDialogShell.Header>
                <ActionDialogShell.Title>
                  Choose billing cycle for {PLAN_BY_TIER[plan()].name}
                </ActionDialogShell.Title>
                <ActionDialogShell.Description>
                  Select annual or monthly billing before continuing to
                  checkout.
                </ActionDialogShell.Description>
              </ActionDialogShell.Header>

              <div
                role="radiogroup"
                aria-label="Billing cycle"
                class="flex flex-col gap-2.5"
              >
                <For each={options()}>
                  {(option) => {
                    const selected = () => interval() === option.value;
                    return (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={selected()}
                        onClick={() => setInterval(option.value)}
                        class="flex w-full items-start justify-between gap-3 rounded-lg border px-4 py-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                        classList={{
                          'border-accent bg-active': selected(),
                          'border-edge-muted hover:border-edge': !selected(),
                        }}
                      >
                        <div class="flex flex-col gap-0.5">
                          <div class="flex items-center gap-2">
                            <span class="text-sm font-medium text-ink">
                              {option.label}
                            </span>
                            <Show when={option.badge}>
                              {(badge) => (
                                <span class="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent">
                                  {badge()}
                                </span>
                              )}
                            </Show>
                          </div>
                          <span class="text-xs text-ink-extra-muted">
                            {option.detail}
                          </span>
                        </div>
                        <span class="shrink-0 text-sm font-medium tabular-nums text-ink">
                          {option.price}
                        </span>
                      </button>
                    );
                  }}
                </For>
              </div>
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
                onClick={() => props.onConfirm(plan(), interval())}
              >
                Continue to checkout
              </Button>
            </ActionDialogShell.Footer>
          </ActionDialogShell>
        )}
      </Show>
    </Dialog>
  );
}
