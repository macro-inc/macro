import type { AiUsageSnapshot } from '@service-auth/ai-billing-types';
import { monthlyUsagePercent, type UsageSummary } from '../core/usage';

export function toUsageSummary(snapshot: AiUsageSnapshot): UsageSummary {
  return {
    monthlyPercent: monthlyUsagePercent(
      snapshot.used_cents,
      snapshot.included_cents
    ),
    periodEnd: snapshot.period_end,
    unlimited: snapshot.unlimited,
    creditBalanceCents: snapshot.credit_balance_cents,
    existingUsageBilling:
      snapshot.tier !== 'free' &&
      (snapshot.overage_enabled || snapshot.overage_suspended)
        ? {
            limitCents: snapshot.overage_limit_cents,
            suspended: snapshot.overage_suspended,
          }
        : undefined,
    billingAccess:
      snapshot.tier === 'free'
        ? 'free'
        : snapshot.can_manage_billing
          ? 'payer'
          : 'team-member',
  };
}
