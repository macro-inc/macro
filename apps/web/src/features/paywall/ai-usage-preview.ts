import { DEV_MODE_ENV } from '@core/constant/featureFlags';
import type { AiUsageSnapshot } from '@service-auth/ai-billing-types';
import { createSignal } from 'solid-js';

const [exhaustedPreview, setExhaustedPreview] = createSignal(false);

/** Development-only display state shared by Usage and the usage-limit dialog. */
export function useAiUsagePreview() {
  const active = () => DEV_MODE_ENV && exhaustedPreview();
  const setActive = (value: boolean) =>
    setExhaustedPreview(DEV_MODE_ENV && value);

  const withPreview = (snapshot: AiUsageSnapshot | undefined) => {
    if (!snapshot || !active()) return snapshot;
    // Free accounts currently have no dollar allowance in the billing summary.
    const included =
      snapshot.included_cents > 0 ? snapshot.included_cents : 4_000;
    return {
      ...snapshot,
      unlimited: false,
      included_cents: included,
      used_cents: included,
      credits_consumed_cents: 0,
      credit_balance_cents: 0,
      overage_enabled: false,
      overage_charged_cents: 0,
      overage_suspended: false,
      uncovered_cents: 0,
      remaining_cents: 0,
      blocked_reason: 'allowance_exhausted' as const,
    };
  };

  return { active, setActive, withPreview };
}
