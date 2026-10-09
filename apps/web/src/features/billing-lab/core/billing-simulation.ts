import { match } from 'ts-pattern';
import type { PlanTier } from '../../paywall/plans';
import type { AutoReloadSettings } from '../../usage/core/usage';
import { DEFAULT_AUTO_RELOAD } from '../../usage/core/usage';

/** Deliberately fixed fixture values; production pricing still comes from the API. */
export const FIXTURE_ALLOWANCES: Record<PlanTier, number> = {
  free: 100,
  premium: 2_000,
  max: 20_000,
};

export const SCENARIOS = [
  {
    id: 'max-to-pro',
    group: 'Plan changes',
    title: 'Max → Pro at renewal',
    description:
      'A downgrade is scheduled. Max access and usage stay in place until renewal.',
  },
  {
    id: 'max',
    group: 'Plan changes',
    title: 'Max, mid-cycle',
    description: 'Inspect Max access and usage during an active billing cycle.',
  },
  {
    id: 'pro',
    group: 'Plan changes',
    title: 'Pro, ready to upgrade',
    description:
      'Upgrade to Max and inspect the fresh allowance without moving the renewal date.',
  },
  {
    id: 'canceling',
    group: 'Plan changes',
    title: 'Subscription ending',
    description:
      'Paid access lasts until renewal, then the account becomes Free.',
  },
  {
    id: 'free',
    group: 'Usage & credits',
    title: 'Free account',
    description: 'Preview the plan cards, free allowance, and upgrade flow.',
  },
  {
    id: 'free-exhausted',
    group: 'Usage & credits',
    title: 'Free limit reached',
    description: 'The free allowance is exhausted. View the upgrade prompt.',
  },
  {
    id: 'pro-exhausted',
    group: 'Usage & credits',
    title: 'Pro limit reached',
    description: 'Included AI is exhausted and no credits remain.',
  },
  {
    id: 'credits',
    group: 'Usage & credits',
    title: 'Using additional credits',
    description:
      'Included usage is exhausted. A prepaid balance keeps AI available.',
  },
  {
    id: 'reload-paused',
    group: 'Usage & credits',
    title: 'Automatic reload paused',
    description:
      'A reload payment failed. Inspect the paused state and retry controls.',
  },
  {
    id: 'spending-limit',
    group: 'Usage & credits',
    title: 'Spending limit reached',
    description:
      'Inspect the limit dialog and existing usage-billing controls.',
  },
  {
    id: 'payment-failed',
    group: 'Usage & credits',
    title: 'Usage payment failed',
    description: 'Preview the payment-failure message and payment-method flow.',
  },
  {
    id: 'team-member',
    group: 'Access & loading',
    title: 'Team-paid Max member',
    description:
      'The team pays for this seat; billing controls belong to the owner.',
  },
  {
    id: 'team-owner',
    group: 'Access & loading',
    title: 'Mixed-plan team owner',
    description: 'An owner with one Max seat and three Pro seats.',
  },
  {
    id: 'unlimited',
    group: 'Access & loading',
    title: 'Unlimited access',
    description: 'Inspect the unlimited allowance and hidden credit controls.',
  },
  {
    id: 'loading',
    group: 'Access & loading',
    title: 'Loading usage',
    description: 'The usage summary has not arrived yet.',
  },
  {
    id: 'error',
    group: 'Access & loading',
    title: 'Usage unavailable',
    description: 'Inspect the error state and Try again action.',
  },
  {
    id: 'before-launch',
    group: 'Access & loading',
    title: 'Before billing launch',
    description: 'Inspect disabled usage controls before launch.',
  },
] as const;

export type ScenarioId = (typeof SCENARIOS)[number]['id'];
export type LimitReason =
  | 'allowance_exhausted'
  | 'free_allowance_exhausted'
  | 'overage_limit_reached'
  | 'overage_payment_failed';
export type BillingSimulation = {
  scenario: ScenarioId;
  tier: PlanTier;
  scheduledPlan?: PlanTier;
  now: string;
  periodStart: string;
  periodEnd: string;
  usedCents: number;
  creditBalanceCents: number;
  creditsConsumedCents: number;
  role: 'solo' | 'owner' | 'member';
  unlimited: boolean;
  status: 'ready' | 'loading' | 'error' | 'before-launch';
  blockedReason?: LimitReason;
  overageEnabled: boolean;
  overageSuspended: boolean;
  overageLimitCents: number;
  autoReload: AutoReloadSettings;
  reloadSuspended: boolean;
};

export function parseScenario(value: string | null): ScenarioId {
  return (
    SCENARIOS.find((scenario) => scenario.id === value)?.id ?? 'max-to-pro'
  );
}

export function includedCents(state: BillingSimulation): number {
  return (
    FIXTURE_ALLOWANCES[state.tier] +
    (state.role === 'owner' ? 3 * FIXTURE_ALLOWANCES.premium : 0)
  );
}

export function createScenario(scenario: ScenarioId): BillingSimulation {
  const state: BillingSimulation = {
    scenario,
    tier: 'premium',
    now: '2026-10-15T12:00:00.000Z',
    periodStart: '2026-10-01T12:00:00.000Z',
    periodEnd: '2026-11-01T12:00:00.000Z',
    usedCents: 1_000,
    creditBalanceCents: 0,
    creditsConsumedCents: 0,
    role: 'solo',
    unlimited: false,
    status: 'ready',
    overageEnabled: false,
    overageSuspended: false,
    overageLimitCents: 5_000,
    autoReload: { ...DEFAULT_AUTO_RELOAD },
    reloadSuspended: false,
  };
  return match(scenario)
    .returnType<BillingSimulation>()
    .with('max-to-pro', () => ({
      ...state,
      tier: 'max',
      usedCents: 12_000,
      scheduledPlan: 'premium',
    }))
    .with('max', () => ({ ...state, tier: 'max', usedCents: 12_000 }))
    .with('canceling', () => ({ ...state, scheduledPlan: 'free' }))
    .with('free', () => ({ ...state, tier: 'free', usedCents: 45 }))
    .with('free-exhausted', () => ({
      ...state,
      tier: 'free',
      usedCents: 100,
      blockedReason: 'free_allowance_exhausted',
    }))
    .with('pro-exhausted', () => ({
      ...state,
      usedCents: 2_000,
      blockedReason: 'allowance_exhausted',
    }))
    .with('credits', () => ({
      ...state,
      usedCents: 2_000,
      creditBalanceCents: 2_500,
    }))
    .with('reload-paused', () => ({
      ...state,
      usedCents: 2_000,
      overageEnabled: true,
      reloadSuspended: true,
      autoReload: { ...state.autoReload, enabled: true },
    }))
    .with('spending-limit', () => ({
      ...state,
      usedCents: 2_000,
      overageEnabled: true,
      autoReload: { ...state.autoReload, enabled: true },
      blockedReason: 'overage_limit_reached',
    }))
    .with('payment-failed', () => ({
      ...state,
      usedCents: 2_000,
      overageEnabled: true,
      overageSuspended: true,
      blockedReason: 'overage_payment_failed',
      reloadSuspended: true,
      autoReload: { ...state.autoReload, enabled: true },
    }))
    .with('team-member', () => ({
      ...state,
      tier: 'max',
      role: 'member',
      usedCents: 12_000,
    }))
    .with('team-owner', () => ({
      ...state,
      tier: 'max',
      role: 'owner',
      usedCents: 15_000,
    }))
    .with('unlimited', () => ({ ...state, tier: 'max', unlimited: true }))
    .with('loading', () => ({ ...state, status: 'loading' }))
    .with('error', () => ({ ...state, status: 'error' }))
    .with('before-launch', () => ({ ...state, status: 'before-launch' }))
    .with('pro', () => state)
    .exhaustive();
}

/** UI fixture transitions only; the backend remains the billing-policy authority. */
export function changePlan(
  state: BillingSimulation,
  tier: PlanTier
): BillingSimulation {
  if (state.role === 'member') return state;
  if (tier === state.tier) return { ...state, scheduledPlan: undefined };
  const upgrading = state.tier === 'free' || tier === 'max';
  if (!upgrading) return { ...state, scheduledPlan: tier };
  return {
    ...state,
    tier,
    scheduledPlan: undefined,
    usedCents: 0,
    blockedReason: undefined,
  };
}

export function renew(state: BillingSimulation): BillingSimulation {
  const nextEnd = new Date(state.periodEnd);
  nextEnd.setUTCMonth(nextEnd.getUTCMonth() + 1);
  return {
    ...state,
    tier: state.scheduledPlan ?? state.tier,
    scheduledPlan: undefined,
    now: state.periodEnd,
    periodStart: state.periodEnd,
    periodEnd: nextEnd.toISOString(),
    usedCents: 0,
    creditsConsumedCents: 0,
    blockedReason: undefined,
  };
}

export function advanceDays(
  state: BillingSimulation,
  days: number
): BillingSimulation {
  const now = new Date(state.now);
  now.setUTCDate(now.getUTCDate() + days);
  let next = state;
  while (now.getTime() >= Date.parse(next.periodEnd)) next = renew(next);
  return { ...next, now: now.toISOString() };
}

export function setUsage(
  state: BillingSimulation,
  percentage: number
): BillingSimulation {
  const usedCents = Math.round(
    (includedCents(state) * Math.min(100, Math.max(0, percentage))) / 100
  );
  return {
    ...state,
    usedCents,
    blockedReason:
      usedCents >= includedCents(state) &&
      state.creditBalanceCents === 0 &&
      !state.overageEnabled &&
      !state.unlimited
        ? state.tier === 'free'
          ? 'free_allowance_exhausted'
          : 'allowance_exhausted'
        : undefined,
  };
}
