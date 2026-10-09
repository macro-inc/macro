import type { AiUsageSnapshot } from '@service-auth/ai-billing-types';
import {
  type BillingSimulation,
  includedCents,
} from '../core/billing-simulation';

/** Adapt local fixture facts to the same decoder used by the live Usage view. */
export function fixtureSnapshot(state: BillingSimulation): AiUsageSnapshot {
  const included = includedCents(state);
  return {
    tier: state.tier,
    unlimited: state.unlimited,
    payer: 'billing-lab',
    can_manage_billing: state.role !== 'member',
    seats: state.role === 'solo' ? 1 : 4,
    period_start: state.periodStart,
    period_end: state.periodEnd,
    included_cents: included,
    used_cents: state.usedCents,
    remaining_cents: Math.max(0, included - state.usedCents),
    credit_balance_cents: state.creditBalanceCents,
    credits_consumed_cents: state.creditsConsumedCents,
    overage_enabled: state.overageEnabled,
    overage_limit_cents: state.overageLimitCents,
    overage_charged_cents:
      state.blockedReason === 'overage_limit_reached'
        ? state.overageLimitCents
        : 0,
    overage_suspended: state.overageSuspended,
    uncovered_cents: 0,
    blocked_reason: state.blockedReason,
    auto_reload: {
      minimum_balance_cents: state.autoReload.minimumBalanceCents,
      target_balance_cents: state.autoReload.targetBalanceCents,
      monthly_spend_limit_cents: state.autoReload.monthlySpendLimitCents,
      suspended: state.reloadSuspended,
      active: state.autoReload.enabled && !state.reloadSuspended,
    },
  };
}
