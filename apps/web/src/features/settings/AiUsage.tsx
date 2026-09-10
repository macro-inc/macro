import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { toast } from '@core/component/Toast/Toast';
import {
  useAiBillingPlansQuery,
  useCreateAiCreditCheckoutMutation,
  useUpdateAiOverageMutation,
} from '@queries/auth';
import type {
  AiDenyReason,
  AiUsageSnapshot,
} from '@service-auth/ai-billing-types';
import { Button, cn, ToggleSwitch } from '@ui';
import { createMemo, createSignal, For, Match, Show, Switch } from 'solid-js';

/** Whole dollars when even, otherwise dollars and cents. */
export function formatCents(cents: number): string {
  const dollars = cents / 100;
  return Number.isInteger(dollars)
    ? `$${dollars.toLocaleString()}`
    : `$${dollars.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
}

function formatPeriodEnd(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const BLOCKED_COPY: Record<AiDenyReason, string> = {
  allowance_exhausted:
    "You've used this period's included AI. Add credits, turn on usage billing, or upgrade to keep going.",
  overage_limit_reached:
    "You've reached your usage billing limit for this period. Raise the limit or add credits to keep going.",
  overage_payment_failed:
    "Your last AI usage charge didn't go through. Update your payment method in Manage, then turn usage billing back on.",
};

/** Fallback caps offered when the catalog has not loaded yet. */
const DEFAULT_OVERAGE_LIMITS_CENTS = [2_500, 5_000, 10_000, 25_000];
const DEFAULT_CREDIT_PACKS_CENTS = [1_000, 2_500, 5_000, 10_000];

/**
 * The period's AI position: a meter of included usage plus credits and overage
 * headroom, and where the user stands right now.
 */
export function AiUsageMeter(props: { snapshot: AiUsageSnapshot }) {
  const included = () => props.snapshot.included_cents;
  const used = () => props.snapshot.used_cents;
  const includedUsed = () => Math.min(used(), included());
  const beyond = () => Math.max(0, used() - included());
  const pct = () =>
    included() > 0 ? Math.min(100, (includedUsed() / included()) * 100) : 0;
  const beyondPct = () =>
    included() > 0 ? Math.min(100, (beyond() / included()) * 100) : 0;
  const blocked = () => !!props.snapshot.blocked_reason;

  return (
    <div class="flex flex-col gap-2">
      <div class="flex items-baseline justify-between gap-3">
        <span class="text-sm text-ink">
          <span class="font-semibold">{formatCents(used())}</span>
          <span class="text-ink-muted">
            {' '}
            of {formatCents(included())} included
          </span>
          <Show when={props.snapshot.seats > 1}>
            <span class="text-ink-extra-muted">
              {' '}
              across {props.snapshot.seats} seats
            </span>
          </Show>
        </span>
        <span class="text-xs text-ink-extra-muted">
          Resets {formatPeriodEnd(props.snapshot.period_end)}
        </span>
      </div>
      <div class="relative h-2 w-full overflow-hidden rounded-full bg-active">
        <div
          class={cn(
            'absolute inset-y-0 left-0 rounded-full transition-[width]',
            blocked() ? 'bg-failure' : 'bg-accent'
          )}
          style={{ width: `${pct()}%` }}
        />
        <Show when={beyond() > 0}>
          <div
            class="absolute inset-y-0 rounded-full bg-warning/70"
            style={{ left: `${pct()}%`, width: `${beyondPct()}%` }}
          />
        </Show>
      </div>
      <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
        <Show when={beyond() > 0}>
          <span>{formatCents(beyond())} beyond included</span>
        </Show>
        <span>
          Credits:{' '}
          <span class="text-ink">
            {formatCents(props.snapshot.credit_balance_cents)}
          </span>
        </span>
        <Show when={props.snapshot.overage_enabled}>
          <span>
            Usage billing this period:{' '}
            <span class="text-ink">
              {formatCents(props.snapshot.overage_charged_cents)}
            </span>{' '}
            of {formatCents(props.snapshot.overage_limit_cents)}
          </span>
        </Show>
      </div>
      <Show when={props.snapshot.blocked_reason}>
        {(reason) => (
          <p class="text-xs text-failure">{BLOCKED_COPY[reason()]}</p>
        )}
      </Show>
    </div>
  );
}

/**
 * The payer's controls: buy a credit pack, and turn usage billing on or off
 * with a per-period cap. Members who are not the payer see who to ask.
 */
export function AiUsageControls(props: {
  snapshot: AiUsageSnapshot;
  /** Where Stripe returns after a credit purchase. */
  returnUrl: string;
}) {
  const analytics = useAnalytics();
  const plans = useAiBillingPlansQuery();
  const updateOverage = useUpdateAiOverageMutation();
  const creditCheckout = useCreateAiCreditCheckoutMutation();

  const creditPacks = () =>
    plans.isSuccess
      ? plans.data.credit_packs_cents
      : DEFAULT_CREDIT_PACKS_CENTS;
  const overageLimits = createMemo(() => {
    const current = props.snapshot.overage_limit_cents;
    const options = [...DEFAULT_OVERAGE_LIMITS_CENTS];
    if (current > 0 && !options.includes(current)) {
      options.push(current);
      options.sort((a, b) => a - b);
    }
    return options;
  });
  const [pendingLimit, setPendingLimit] = createSignal<number | null>(null);
  const selectedLimit = () =>
    pendingLimit() ??
    (props.snapshot.overage_limit_cents > 0
      ? props.snapshot.overage_limit_cents
      : DEFAULT_OVERAGE_LIMITS_CENTS[1]);

  const busy = () => updateOverage.isPending || creditCheckout.isPending;

  const buyCredits = async (amountCents: number) => {
    try {
      analytics.track('ai_credits_checkout_start', { amountCents });
      const url = await creditCheckout.mutateAsync({
        amountCents,
        successUrl: `${props.returnUrl}?aiCreditsSuccess=true`,
        cancelUrl: `${props.returnUrl}?aiCreditsCancel=true`,
      });
      window.location.href = url;
    } catch (error) {
      console.error(error);
      toast.failure("Couldn't start the credit purchase. Please try again.");
    }
  };

  const setOverage = async (enabled: boolean, limitCents: number) => {
    try {
      await updateOverage.mutateAsync({ enabled, limitCents });
      analytics.track('ai_overage_updated', { enabled, limitCents });
      setPendingLimit(null);
      toast.success(
        enabled
          ? `Usage billing on, up to ${formatCents(limitCents)} per period.`
          : 'Usage billing off.'
      );
    } catch (error) {
      console.error(error);
      toast.failure("Couldn't update usage billing. Please try again.");
    }
  };

  return (
    <Show
      when={props.snapshot.can_manage_billing}
      fallback={
        <p class="text-xs text-ink-extra-muted">
          AI usage for your team is managed by the team owner. Ask them to add
          credits or turn on usage billing.
        </p>
      }
    >
      <div class="flex flex-col gap-5">
        <div class="flex flex-col gap-2">
          <div class="flex flex-col">
            <span class="text-sm text-ink">Add credits</span>
            <span class="text-xs text-ink-extra-muted">
              Prepaid AI usage that applies after your included amount, and
              carries over between periods.
            </span>
          </div>
          <div class="flex flex-wrap gap-2">
            <For each={creditPacks()}>
              {(cents) => (
                <Button
                  variant="outline"
                  size="sm"
                  depth={2}
                  class="rounded-full"
                  disabled={busy()}
                  onClick={() => void buyCredits(cents)}
                >
                  {formatCents(cents)}
                </Button>
              )}
            </For>
          </div>
        </div>

        <div class="flex flex-col gap-2">
          <div class="flex items-start justify-between gap-4">
            <div class="flex flex-col">
              <span class="text-sm text-ink">Usage billing</span>
              <span class="text-xs text-ink-extra-muted">
                Bill AI beyond your included amount and credits to your card in{' '}
                {formatCents(1_000)} increments, up to a limit you set.
              </span>
            </div>
            <ToggleSwitch
              size="md"
              checked={props.snapshot.overage_enabled}
              disabled={busy()}
              onChange={(checked) => void setOverage(checked, selectedLimit())}
            />
          </div>
          <Switch>
            <Match when={props.snapshot.overage_suspended}>
              <p class="text-xs text-failure">
                Paused after a failed charge. Fix your payment method under
                Manage, then turn usage billing back on to retry.
              </p>
            </Match>
            <Match when={props.snapshot.overage_enabled}>
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-xs text-ink-muted">Limit per period</span>
                <For each={overageLimits()}>
                  {(cents) => (
                    <Button
                      variant={selectedLimit() === cents ? 'accent' : 'outline'}
                      size="xs"
                      depth={2}
                      class="rounded-full px-2"
                      disabled={busy()}
                      onClick={() => {
                        setPendingLimit(cents);
                        void setOverage(true, cents);
                      }}
                    >
                      {formatCents(cents)}
                    </Button>
                  )}
                </For>
              </div>
            </Match>
          </Switch>
        </div>
      </div>
    </Show>
  );
}
