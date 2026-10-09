import type { AiUsageSnapshot } from '@service-auth/ai-billing-types';
import {
  DEFAULT_AUTO_RELOAD,
  monthlyUsagePercent,
  type UsageSummary,
} from '../core/usage';

function toAutoReload(snapshot: AiUsageSnapshot): UsageSummary['autoReload'] {
  const reload = snapshot.auto_reload;
  const thresholds = reload
    ? {
        minimumBalanceCents: reload.minimum_balance_cents,
        targetBalanceCents: reload.target_balance_cents,
        monthlySpendLimitCents: reload.monthly_spend_limit_cents,
      }
    : DEFAULT_AUTO_RELOAD;
  return {
    settings: { ...thresholds, enabled: snapshot.overage_enabled },
    suspended: reload?.suspended ?? false,
  };
}

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
    autoReload: toAutoReload(snapshot),
    billingAccess:
      snapshot.tier === 'free'
        ? 'free'
        : snapshot.can_manage_billing
          ? 'payer'
          : 'team-member',
  };
}
