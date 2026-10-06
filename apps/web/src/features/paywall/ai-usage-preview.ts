import { DEV_MODE_ENV } from '@core/constant/featureFlags';
import type {
  AiPlanCatalogEntry,
  AiUsageSnapshot,
} from '@service-auth/ai-billing-types';
import { createSignal } from 'solid-js';
import type { UsagePreviewPlan } from '../usage/core/usage';

const [preview, setPreview] = createSignal<{
  plan?: UsagePreviewPlan;
  exhausted: boolean;
  beforeLaunch: boolean;
}>();

function previewPeriod(
  snapshot: AiUsageSnapshot | undefined,
  tier: 'free' | 'premium'
) {
  if (tier === 'premium' && snapshot) {
    return {
      period_start: snapshot.period_start,
      period_end: snapshot.period_end,
    };
  }
  const now = new Date();
  return {
    period_start: new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
    ).toISOString(),
    period_end: new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
    ).toISOString(),
  };
}

/** Development-only display state shared by Usage and the usage-limit dialog. */
export function useAiUsagePreview() {
  const state = () => (DEV_MODE_ENV ? preview() : undefined);
  const active = () => !!state();
  const plan = () => state()?.plan;
  const beforeLaunch = () => state()?.beforeLaunch === true;
  const previewPlan = (plan: UsagePreviewPlan) => {
    if (DEV_MODE_ENV) {
      setPreview((current) => ({
        plan,
        exhausted: false,
        beforeLaunch: current?.beforeLaunch ?? false,
      }));
    }
  };
  const previewLimit = (plan: UsagePreviewPlan) => {
    if (DEV_MODE_ENV)
      setPreview({ plan, exhausted: true, beforeLaunch: false });
  };
  const previewBeforeLaunch = () => {
    if (DEV_MODE_ENV) {
      setPreview((current) => ({
        plan: current?.plan,
        exhausted: false,
        beforeLaunch: true,
      }));
    }
  };
  const reset = () => setPreview(undefined);

  const withPreview = (
    snapshot: AiUsageSnapshot | undefined,
    plans?: readonly AiPlanCatalogEntry[]
  ): AiUsageSnapshot | undefined => {
    const selected = state();
    if (!selected?.plan) return snapshot;
    const tier = selected.plan === 'free' ? 'free' : 'premium';
    const allowance = plans?.find(
      (entry) => entry.tier === tier
    )?.included_ai_cents_per_seat;
    // The fallback only supplies a denominator for the display preview.
    const included =
      allowance && allowance > 0
        ? allowance
        : snapshot?.tier === tier && snapshot.included_cents > 0
          ? snapshot.included_cents
          : 100;
    const used = selected.exhausted ? included : included / 2;
    return {
      ...snapshot,
      ...previewPeriod(snapshot, tier),
      tier,
      unlimited: false,
      payer: snapshot?.payer ?? 'developer-preview',
      can_manage_billing: true,
      seats: 1,
      included_cents: included,
      used_cents: used,
      credits_consumed_cents: 0,
      credit_balance_cents:
        selected.plan === 'paid' && !selected.exhausted ? 2_500 : 0,
      overage_enabled: false,
      overage_limit_cents: 0,
      overage_charged_cents: 0,
      overage_suspended: false,
      uncovered_cents: 0,
      remaining_cents: included - used,
      blocked_reason: selected.exhausted
        ? tier === 'free'
          ? 'free_allowance_exhausted'
          : 'allowance_exhausted'
        : undefined,
    };
  };

  return {
    active,
    plan,
    beforeLaunch,
    previewPlan,
    previewLimit,
    previewBeforeLaunch,
    reset,
    withPreview,
  };
}
