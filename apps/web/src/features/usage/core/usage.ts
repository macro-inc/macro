export type UsageSummary = {
  monthlyPercent: number;
  periodEnd: string;
  unlimited: boolean;
  creditBalanceCents: number;
  billingAccess: 'free' | 'payer' | 'team-member';
  existingUsageBilling?: { limitCents: number; suspended: boolean };
  autoReload: { settings: AutoReloadSettings; suspended: boolean };
};

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
    settings.monthlySpendLimitCents <= 0
  ) {
    return 'Enter a monthly spend limit greater than $0, or leave it blank.';
  }
}
