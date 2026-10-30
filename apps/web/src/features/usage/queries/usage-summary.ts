import type {
  AiPlanCatalog,
  AiUsageSnapshot,
} from '@service-auth/ai-billing-types';
import {
  type AutoReloadSettings,
  DEFAULT_AUTO_RELOAD,
  monthlyUsagePercent,
  type UsageSummary,
} from '../core/usage';

/**
 * The thresholds Auto-Reload starts from while it is off: the catalog's
 * defaults and the plan's monthly limit, rather than whatever an account row
 * stored before the payer opted in.
 */
function startingThresholds(
  snapshot: AiUsageSnapshot,
  catalog: AiPlanCatalog
): Omit<AutoReloadSettings, 'enabled'> {
  const defaults = catalog.auto_reload_defaults;
  const plan = catalog.plans.find((entry) => entry.tier === snapshot.tier);
  return {
    minimumBalanceCents:
      defaults?.minimum_balance_cents ??
      DEFAULT_AUTO_RELOAD.minimumBalanceCents,
    targetBalanceCents:
      defaults?.target_balance_cents ?? DEFAULT_AUTO_RELOAD.targetBalanceCents,
    monthlySpendLimitCents:
      plan?.auto_reload_default_monthly_limit_cents ?? null,
  };
}

function toAutoReload(
  snapshot: AiUsageSnapshot,
  catalog: AiPlanCatalog | undefined
): UsageSummary['autoReload'] {
  const reload = snapshot.auto_reload;
  const thresholds =
    !snapshot.overage_enabled && catalog
      ? startingThresholds(snapshot, catalog)
      : reload
        ? {
            minimumBalanceCents: reload.minimum_balance_cents,
            targetBalanceCents: reload.target_balance_cents,
            monthlySpendLimitCents: reload.monthly_spend_limit_cents,
          }
        : DEFAULT_AUTO_RELOAD;
  return {
    settings: { ...thresholds, enabled: snapshot.overage_enabled },
    suspended: reload?.suspended ?? false,
    ...(reload?.monthly_budget && reload.monthly_spend_limit_cents !== null
      ? {
          budget: {
            spentCents: reload.monthly_budget.committed_cents,
            limitCents: reload.monthly_spend_limit_cents,
            resetsAt: reload.monthly_budget.resets_at,
            limitReached: reload.monthly_budget.limit_reached,
          },
        }
      : {}),
  };
}

export function toUsageSummary(
  snapshot: AiUsageSnapshot,
  catalog?: AiPlanCatalog
): UsageSummary {
  return {
    monthlyPercent: monthlyUsagePercent(
      snapshot.used_cents,
      snapshot.included_cents
    ),
    periodEnd: snapshot.period_end,
    unlimited: snapshot.unlimited,
    creditBalanceCents: snapshot.credit_balance_cents,
    creditScope:
      (snapshot.credits_shared_with_team ?? snapshot.seats > 1)
        ? 'team'
        : 'personal',
    existingUsageBilling:
      snapshot.tier !== 'free' &&
      (snapshot.overage_enabled || snapshot.overage_suspended)
        ? {
            limitCents: snapshot.overage_limit_cents,
            suspended: snapshot.overage_suspended,
          }
        : undefined,
    autoReload: toAutoReload(snapshot, catalog),
    ...(snapshot.credit_purchase?.monthly_limit_cents != null
      ? {
          purchaseLimit: {
            limitCents: snapshot.credit_purchase.monthly_limit_cents,
            remainingCents: Math.max(
              0,
              snapshot.credit_purchase.monthly_limit_cents -
                snapshot.credit_purchase.committed_cents
            ),
          },
        }
      : {}),
    billingAccess:
      snapshot.tier === 'free'
        ? 'free'
        : snapshot.can_manage_billing
          ? 'payer'
          : 'team-member',
  };
}
