export type UsageSummary = {
  monthlyPercent: number;
  periodEnd: string;
  unlimited: boolean;
  creditBalanceCents: number;
  billingAccess: 'free' | 'payer' | 'team-member';
  existingUsageBilling?: { limitCents: number; suspended: boolean };
  autoReload: { settings: AutoReloadSettings; suspended: boolean };
  /** A charge waiting on the payer to authenticate it; the feature it belongs to is paused until they do. */
  paymentAction?: PaymentAction;
};

export type PaymentAction = {
  kind: 'overage_charge' | 'credit_reload';
  amountCents: number;
  /** Stripe-hosted page to complete the payment on; absent when Stripe only emailed the link. */
  url?: string;
};

/** What the payer is told about a payment waiting on their authentication. */
export function describePaymentAction(action: PaymentAction) {
  const amount = formatCreditBalance(action.amountCents);
  return action.kind === 'credit_reload'
    ? `An automatic reload of ${amount} needs you to confirm it with your bank. Automatic reload is paused until you do.`
    : `A usage charge of ${amount} needs you to confirm it with your bank. Usage billing is paused until you do.`;
}

export type UsagePreviewPlan = 'free' | 'paid';

export type AutoReloadSettings = {
  enabled: boolean;
  minimumBalanceCents: number;
  targetBalanceCents: number;
  monthlySpendLimitCents: number | null;
};

export const DEFAULT_AUTO_RELOAD: AutoReloadSettings = {
  enabled: false,
  minimumBalanceCents: 1_000,
  targetBalanceCents: 10_000,
  monthlySpendLimitCents: null,
};

/** The smallest reload the backend will charge, so target must exceed minimum by this much. */
export const MIN_RELOAD_CENTS = 50;

export const MAX_TARGET_BALANCE_CENTS = 500_000;

/**
 * The monthly spend limit also caps usage billing, which the backend clamps to
 * at least this much (`OVERAGE_LIMIT_MIN_CENTS`), so a smaller limit would be
 * silently raised.
 */
export const MIN_MONTHLY_SPEND_LIMIT_CENTS = 500;

/** Development remains interactive; production follows the UI rollout flag. */
export function isUsageAvailable(
  production: boolean,
  flagEnabled: boolean | undefined
) {
  return !production || flagEnabled === true;
}

export function monthlyUsagePercent(usedCents: number, includedCents: number) {
  if (includedCents <= 0) return usedCents > 0 ? 100 : 0;
  return Math.min(100, Math.max(0, (usedCents / includedCents) * 100));
}

export function formatCreditBalance(cents: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

/** Parse decimal dollars without rounding fractional cents or accepting exponents. */
export function parseDollarInput(value: string): number | undefined {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) return;
  const cents =
    Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : undefined;
}

export function validateAutoReload(
  settings: AutoReloadSettings
): string | undefined {
  if (settings.minimumBalanceCents <= 0)
    return 'Enter a minimum balance greater than $0.';
  if (
    settings.targetBalanceCents <
    settings.minimumBalanceCents + MIN_RELOAD_CENTS
  ) {
    return `Target balance must be greater than minimum balance by at least ${formatCreditBalance(MIN_RELOAD_CENTS)}.`;
  }
  if (settings.targetBalanceCents > MAX_TARGET_BALANCE_CENTS) {
    return `Target balance can be at most ${formatCreditBalance(MAX_TARGET_BALANCE_CENTS)}.`;
  }
  if (
    settings.monthlySpendLimitCents !== null &&
    settings.monthlySpendLimitCents < MIN_MONTHLY_SPEND_LIMIT_CENTS
  ) {
    return `Monthly spend limit must be at least ${formatCreditBalance(MIN_MONTHLY_SPEND_LIMIT_CENTS)}, or leave it blank.`;
  }
}
