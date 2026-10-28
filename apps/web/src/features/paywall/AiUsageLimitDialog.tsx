import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useAiUsageLimitState } from '@core/constant/AiUsageLimitState';
import {
  enableAiUsageBilling,
  LOCAL_ONLY,
  PROD_MODE_ENV,
} from '@core/constant/featureFlags';
import { useSettingsState } from '@core/constant/SettingsState';
import { useAiBillingSummaryQuery } from '@queries/auth';
import { Suspense } from 'solid-js';
import { isUsageAvailable, monthlyUsagePercent } from '../usage/core/usage';
import { useAiUsagePreview } from './ai-usage-preview';
import { AiUsageLimitDialogView } from './components/ai-usage-limit-dialog';

/**
 * Shown when the backend refuses an AI request with a billing code. Shows the
 * monthly limit and offers paid subscriptions to Free users or usage credits
 * to paid users.
 */
export function AiUsageLimitDialog() {
  const { usageLimitOpen, usageLimitCode, hideUsageLimit } =
    useAiUsageLimitState();
  const { openSettings } = useSettingsState();
  const summary = useAiBillingSummaryQuery({ enabled: usageLimitOpen });
  const aiUsageBilling = useFeatureFlag(enableAiUsageBilling);
  const usagePreview = useAiUsagePreview();
  const available = () =>
    !usagePreview.beforeLaunch() &&
    isUsageAvailable(PROD_MODE_ENV && !LOCAL_ONLY, aiUsageBilling().enabled);
  const usageSnapshot = () =>
    usagePreview.withPreview(summary.isSuccess ? summary.data : undefined);
  const freePlan = () =>
    usageLimitCode() === 'ai_free_allowance_exhausted' ||
    usageSnapshot()?.tier === 'free';

  const usage = () => {
    const snapshot = usageSnapshot();
    return snapshot
      ? {
          percentage: monthlyUsagePercent(
            snapshot.used_cents,
            snapshot.included_cents
          ),
          periodEnd: snapshot.period_end,
          unlimited: snapshot.unlimited,
        }
      : undefined;
  };
  return (
    <Suspense fallback={null}>
      <AiUsageLimitDialogView
        open={usageLimitOpen() && available()}
        code={usageLimitCode() ?? undefined}
        freePlan={freePlan()}
        usage={usage()}
        previewNotice={
          usagePreview.active()
            ? `Developer preview: ${usagePreview.plan() === 'free' ? 'Free' : 'paid'} plan. No account billing has changed.`
            : undefined
        }
        onClose={hideUsageLimit}
        onOpenSettings={() => {
          const target = freePlan() ? 'Billing' : 'Usage';
          hideUsageLimit();
          openSettings(target);
        }}
      />
    </Suspense>
  );
}
